import {
  QaDesignContext,
  QaDesignBounds,
  QaDesignControl,
  QaDesignEffect,
  QaDesignInteraction,
  QaDesignLayout,
  QaDesignPaint,
  QaDesignPlatform,
  QaDesignReference,
  QaDesignScreen,
  QaDesignTextStyle,
} from '../../types/qaContext';
import { DesignProvider } from './designProvider';

interface FigmaNode {
  id?: string;
  name?: string;
  type?: string;
  visible?: boolean;
  characters?: string;
  opacity?: number;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  cornerRadius?: number;
  componentId?: string;
  effects?: Array<{
    type?: string;
    visible?: boolean;
    color?: FigmaPaint['color'];
    radius?: number;
    spread?: number;
    offset?: { x?: number; y?: number };
  }>;
  componentProperties?: Record<string, {
    type?: string;
    value?: unknown;
  }>;
  layoutMode?: string;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  style?: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    lineHeightPx?: number;
    letterSpacing?: number;
    textAlignHorizontal?: string;
  };
  children?: FigmaNode[];
  interactions?: Array<{
    trigger?: { type?: string };
    actions?: Array<{
      type?: string;
      destinationId?: string;
    }>;
  }>;
  absoluteBoundingBox?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
}

interface FigmaPaint {
  type?: string;
  color?: {
    r?: number;
    g?: number;
    b?: number;
    a?: number;
  };
  opacity?: number;
  visible?: boolean;
}

interface FigmaNodesResponse {
  name?: string;
  version?: string;
  lastModified?: string;
  nodes?: Record<string, {
    document?: FigmaNode;
  } | null>;
}

interface FigmaFileIndexResponse {
  document?: {
    children?: FigmaNode[];
  };
}

const MAX_NODES = 5000;
const MAX_SCREENS = 200;
const MAX_TEXTS = 300;
const MAX_TEXT_STYLES = 300;
const MAX_CONTROLS = 250;
const MAX_INTERACTIONS = 300;

function detectPlatform(
  fileName: string,
  reference: QaDesignReference
): QaDesignPlatform {
  const value = `${fileName} ${reference.url}`.toLowerCase();

  if (/m[oó]vil|mobile|android|ios/.test(value)) {
    return 'mobile';
  }

  if (/\bweb\b|desktop|browser/.test(value)) {
    return 'web';
  }

  return 'unknown';
}

function toHexChannel(value = 0): string {
  return Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
}

function summarizePaints(
  paints: FigmaPaint[] | undefined
): QaDesignPaint[] {
  return (paints ?? []).slice(0, 5).map(paint => ({
    type: paint.type ?? 'UNKNOWN',
    color: paint.color
      ? `#${toHexChannel(paint.color.r)}` +
        `${toHexChannel(paint.color.g)}` +
        `${toHexChannel(paint.color.b)}`
      : undefined,
    opacity: paint.opacity ?? paint.color?.a,
    visible: paint.visible,
  }));
}

function summarizeBounds(
  bounds: FigmaNode['absoluteBoundingBox']
): QaDesignBounds | undefined {
  if (
    bounds?.x === undefined ||
    bounds.y === undefined ||
    bounds.width === undefined ||
    bounds.height === undefined
  ) {
    return undefined;
  }

  return {
    x: Math.round(bounds.x * 100) / 100,
    y: Math.round(bounds.y * 100) / 100,
    width: Math.round(bounds.width * 100) / 100,
    height: Math.round(bounds.height * 100) / 100,
  };
}

function summarizeEffects(
  effects: FigmaNode['effects']
): QaDesignEffect[] {
  return (effects ?? []).slice(0, 5).map(effect => ({
    type: effect.type ?? 'UNKNOWN',
    visible: effect.visible,
    color: effect.color
      ? `#${toHexChannel(effect.color.r)}` +
        `${toHexChannel(effect.color.g)}` +
        `${toHexChannel(effect.color.b)}`
      : undefined,
    opacity: effect.color?.a,
    radius: effect.radius,
    spread: effect.spread,
    offsetX: effect.offset?.x,
    offsetY: effect.offset?.y,
  }));
}

function summarizeLayout(node: FigmaNode): QaDesignLayout | undefined {
  const layout: QaDesignLayout = {
    mode: node.layoutMode,
    primaryAxisAlignItems: node.primaryAxisAlignItems,
    counterAxisAlignItems: node.counterAxisAlignItems,
    itemSpacing: node.itemSpacing,
    paddingTop: node.paddingTop,
    paddingRight: node.paddingRight,
    paddingBottom: node.paddingBottom,
    paddingLeft: node.paddingLeft,
  };

  return Object.values(layout).some(value => value !== undefined)
    ? layout
    : undefined;
}

function inferControlRole(node: FigmaNode): string | null {
  const value = `${node.name ?? ''} ${node.characters ?? ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const roles: Array<[RegExp, string]> = [
    [/button|boton|\bcta\b/, 'button'],
    [/checkbox|check box/, 'checkbox'],
    [/radio/, 'radio'],
    [/input|textfield|text field|campo/, 'input'],
    [/dropdown|select|combo/, 'select'],
    [/modal|dialog|popup|pop up/, 'dialog'],
    [/progress|progreso/, 'progress'],
    [/navigation|navbar|menu|tab bar/, 'navigation'],
    [/card|tarjeta/, 'card'],
    [/icon|icono/, 'icon'],
  ];

  const matched = roles.find(([pattern]) => pattern.test(value));

  if (matched) {
    return matched[1];
  }

  if (node.type === 'INSTANCE' || node.interactions?.length) {
    return 'interactive-component';
  }

  return null;
}

function getComponentProperties(
  properties: FigmaNode['componentProperties']
): Record<string, string> | undefined {
  if (!properties) {
    return undefined;
  }

  const entries = Object.entries(properties).map(([key, property]) => [
    key,
    String(property.value ?? ''),
  ]);

  return entries.length > 0
    ? Object.fromEntries(entries)
    : undefined;
}

function getControlState(
  properties: Record<string, string> | undefined,
  name: string
): string | undefined {
  const stateEntry = Object.entries(properties ?? {}).find(([key]) =>
    /state|estado/i.test(key)
  );

  if (stateEntry?.[1]) {
    return stateEntry[1];
  }

  return name.match(/disabled|enabled|hover|pressed|default/i)?.[0];
}

function summarizeNode(root: FigmaNode) {
  const screens: QaDesignScreen[] = [];
  const texts = new Set<string>();
  const textStyles: QaDesignTextStyle[] = [];
  const controls: QaDesignControl[] = [];
  const interactions: QaDesignInteraction[] = [];
  let analyzedNodeCount = 0;

  function visit(node: FigmaNode, depth: number): void {
    if (analyzedNodeCount >= MAX_NODES || node.visible === false) {
      return;
    }

    analyzedNodeCount += 1;

    const id = node.id ?? 'unknown';
    const name = node.name?.trim() || 'Sin nombre';
    const type = node.type ?? 'UNKNOWN';

    if (
      screens.length < MAX_SCREENS &&
      depth <= 3 &&
      ['FRAME', 'SECTION', 'COMPONENT', 'COMPONENT_SET'].includes(type)
    ) {
      screens.push({
        id,
        name,
        type,
        width: node.absoluteBoundingBox?.width,
        height: node.absoluteBoundingBox?.height,
        x: node.absoluteBoundingBox?.x,
        y: node.absoluteBoundingBox?.y,
        layout: summarizeLayout(node),
        fills: summarizePaints(node.fills),
      });
    }

    const text = node.characters?.replace(/\s+/g, ' ').trim();

    if (text && texts.size < MAX_TEXTS) {
      texts.add(text.slice(0, 500));
    }

    if (
      text &&
      node.type === 'TEXT' &&
      textStyles.length < MAX_TEXT_STYLES
    ) {
      textStyles.push({
        nodeId: id,
        value: text.slice(0, 500),
        bounds: summarizeBounds(node.absoluteBoundingBox),
        fontFamily: node.style?.fontFamily,
        fontSize: node.style?.fontSize,
        fontWeight: node.style?.fontWeight,
        lineHeightPx: node.style?.lineHeightPx,
        letterSpacing: node.style?.letterSpacing,
        textAlignHorizontal: node.style?.textAlignHorizontal,
        fills: summarizePaints(node.fills),
      });
    }

    const role = inferControlRole(node);

    if (role && controls.length < MAX_CONTROLS) {
      const componentProperties = getComponentProperties(
        node.componentProperties
      );

      controls.push({
        id,
        name,
        nodeType: type,
        role,
        state: getControlState(componentProperties, name),
        text: text?.slice(0, 300),
        bounds: summarizeBounds(node.absoluteBoundingBox),
        layout: summarizeLayout(node),
        fills: summarizePaints(node.fills),
        strokes: summarizePaints(node.strokes),
        strokeWeight: node.strokeWeight,
        cornerRadius: node.cornerRadius,
        opacity: node.opacity,
        effects: summarizeEffects(node.effects),
        componentId: node.componentId,
        componentProperties,
      });
    }

    for (const interaction of node.interactions ?? []) {
      for (const action of interaction.actions ?? []) {
        if (interactions.length >= MAX_INTERACTIONS) {
          break;
        }

        interactions.push({
          sourceNodeId: id,
          sourceNodeName: name,
          trigger: interaction.trigger?.type,
          action: action.type,
          destinationId: action.destinationId,
        });
      }
    }

    for (const child of node.children ?? []) {
      visit(child, depth + 1);
    }
  }

  visit(root, 0);

  return {
    screens,
    visibleTexts: Array.from(texts),
    textStyles,
    controls,
    interactions,
    analyzedNodeCount,
    truncated: analyzedNodeCount >= MAX_NODES,
  };
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function selectMatchingPage(
  pages: FigmaNode[],
  searchTerms: string[]
): FigmaNode | undefined {
  const keywords = searchTerms
    .flatMap(term => normalizeSearchText(term).split(/[^a-z0-9]+/))
    .filter(keyword => keyword.length >= 5);

  return pages
    .map(page => {
      const name = normalizeSearchText(page.name ?? '');
      const score = keywords.reduce(
        (total, keyword) => total + (name.includes(keyword) ? 1 : 0),
        0
      );

      return { page, score };
    })
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.page;
}

function replaceNodeId(
  reference: QaDesignReference,
  nodeId: string
): QaDesignReference {
  const url = new URL(reference.url);
  url.searchParams.set('node-id', nodeId.replace(/:/g, '-'));

  return {
    ...reference,
    nodeId,
    url: url.toString(),
  };
}

export class FigmaRestProvider implements DesignProvider {
  constructor(private readonly accessToken: string) {}

  async getContext(
    reference: QaDesignReference,
    options: { searchTerms?: string[] } = {}
  ): Promise<QaDesignContext> {
    if (!reference.nodeId) {
      throw new Error(
        `La referencia Figma ${reference.url} no contiene node-id`
      );
    }

    let resolvedReference = reference;

    if ((options.searchTerms?.length ?? 0) > 0) {
      const pages = await this.getPages(reference.fileKey);
      const referencedPage = pages.find(
        page => page.id === reference.nodeId
      );

      if (
        referencedPage &&
        normalizeSearchText(referencedPage.name ?? '') === 'cover'
      ) {
        const matchingPage = selectMatchingPage(
          pages,
          options.searchTerms ?? []
        );

        if (matchingPage?.id) {
          resolvedReference = replaceNodeId(
            reference,
            matchingPage.id
          );
        }
      }
    }

    const payload = await this.fetchNode(resolvedReference);
    const root = payload.nodes?.[resolvedReference.nodeId!]?.document;

    if (!root) {
      throw new Error(
        `Figma no devolvió el nodo ${resolvedReference.nodeId} ` +
        `del archivo ${resolvedReference.fileKey}`
      );
    }

    const summary = summarizeNode(root);
    const fileName = payload.name?.trim() || resolvedReference.fileKey;

    return {
      reference: resolvedReference,
      fileName,
      version: payload.version,
      lastModified: payload.lastModified,
      platform: detectPlatform(fileName, resolvedReference),
      rootNode: {
        id: root.id ?? resolvedReference.nodeId!,
        name: root.name?.trim() || 'Sin nombre',
        type: root.type ?? 'UNKNOWN',
      },
      ...summary,
    };
  }

  private async fetchNode(
    reference: QaDesignReference
  ): Promise<FigmaNodesResponse> {
    const endpoint = new URL(
      `https://api.figma.com/v1/files/${reference.fileKey}/nodes`
    );
    endpoint.searchParams.set('ids', reference.nodeId!);

    const response = await this.fetchWithRateLimit(endpoint);

    if (!response.ok) {
      throw new Error(
        `Figma rechazó la lectura del nodo ${reference.nodeId} ` +
        `(HTTP ${response.status})`
      );
    }

    return response.json() as Promise<FigmaNodesResponse>;
  }

  private async getPages(fileKey: string): Promise<FigmaNode[]> {
    const endpoint = new URL(
      `https://api.figma.com/v1/files/${fileKey}`
    );
    endpoint.searchParams.set('depth', '1');

    const response = await this.fetchWithRateLimit(endpoint);

    if (!response.ok) {
      throw new Error(
        `Figma rechazó la lectura del índice del archivo ` +
        `${fileKey} (HTTP ${response.status})`
      );
    }

    const payload = await response.json() as FigmaFileIndexResponse;

    return payload.document?.children ?? [];
  }

  private async fetchWithRateLimit(
    endpoint: URL
  ): Promise<Response> {
    const request = () => fetch(endpoint, {
      headers: {
        'X-Figma-Token': this.accessToken,
      },
    });

    let response = await request();

    if (response.status !== 429) {
      return response;
    }

    const retryAfter = Number(
      response.headers.get('retry-after')
    );

    if (
      !Number.isFinite(retryAfter) ||
      retryAfter <= 0 ||
      retryAfter > 30
    ) {
      return response;
    }

    await new Promise(resolve =>
      setTimeout(resolve, retryAfter * 1000)
    );

    response = await request();

    return response;
  }
}
