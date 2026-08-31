export interface QaTask {
  id: number;
  title: string;
  state: string;
}

export interface QaUserStory {
  id: number;
  title: string;
  state: string;
  description: string;
  acceptanceCriteria: string;
  tasks: QaTask[];
  designReferences: QaDesignReference[];
}

export interface QaTestConfiguration {
  id: number;
  name: string;
  isDefault: boolean;
  values: Array<{
    name: string;
    value: string;
  }>;
}

export interface QaAttachment {
  name: string;
  url: string;
}

export type QaDesignOrigin =
  | 'cli'
  | 'feature'
  | 'epic'
  | 'user-story';

export interface QaDesignReference {
  provider: 'figma';
  url: string;
  fileKey: string;
  nodeId?: string;
  origin: QaDesignOrigin;
  sourceWorkItemId?: number;
}

export type QaDesignPlatform = 'web' | 'mobile' | 'unknown';

export interface QaDesignScreen {
  id: string;
  name: string;
  type: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  layout?: QaDesignLayout;
  fills: QaDesignPaint[];
}

export interface QaDesignPaint {
  type: string;
  color?: string;
  opacity?: number;
  visible?: boolean;
}

export interface QaDesignBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QaDesignEffect {
  type: string;
  visible?: boolean;
  color?: string;
  opacity?: number;
  radius?: number;
  spread?: number;
  offsetX?: number;
  offsetY?: number;
}

export interface QaDesignLayout {
  mode?: string;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
}

export interface QaDesignControl {
  id: string;
  name: string;
  nodeType: string;
  role: string;
  state?: string;
  text?: string;
  bounds?: QaDesignBounds;
  layout?: QaDesignLayout;
  fills: QaDesignPaint[];
  strokes: QaDesignPaint[];
  strokeWeight?: number;
  cornerRadius?: number;
  opacity?: number;
  effects: QaDesignEffect[];
  componentId?: string;
  componentProperties?: Record<string, string>;
}

export interface QaDesignTextStyle {
  nodeId: string;
  value: string;
  bounds?: QaDesignBounds;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  textAlignHorizontal?: string;
  fills: QaDesignPaint[];
}

export interface QaDesignInteraction {
  sourceNodeId: string;
  sourceNodeName: string;
  trigger?: string;
  action?: string;
  destinationId?: string;
}

export interface QaDesignContext {
  reference: QaDesignReference;
  fileName: string;
  version?: string;
  lastModified?: string;
  platform: QaDesignPlatform;
  rootNode: {
    id: string;
    name: string;
    type: string;
  };
  screens: QaDesignScreen[];
  visibleTexts: string[];
  textStyles: QaDesignTextStyle[];
  controls: QaDesignControl[];
  interactions: QaDesignInteraction[];
  analyzedNodeCount: number;
  truncated: boolean;
}

export interface QaContext {
  feature: {
    id: number;
    title: string;
    state: string;
    iterationPath: string;
  };

  epic: {
    id: number;
    title: string;
  };

  userStories: QaUserStory[];

  rfc: {
    name: string;
    text: string;
  };

  designReferences: QaDesignReference[];

  designContexts: QaDesignContext[];

  availableConfigurations: QaTestConfiguration[];
}
