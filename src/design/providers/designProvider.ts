import {
  QaDesignContext,
  QaDesignReference,
} from '../../types/qaContext';

export interface DesignProvider {
  getContext(
    reference: QaDesignReference,
    options?: { searchTerms?: string[] }
  ): Promise<QaDesignContext>;
}
