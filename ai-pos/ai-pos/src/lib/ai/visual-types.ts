/** Shapes of the visuals the AI can return. Shared by the server (hydration) and the client (rendering). */

export type ValueFormat = 'currency' | 'number' | 'percent' | 'text' | 'date';

export interface SeriesDef {
  key: string;
  label: string;
}

export interface ColumnDef {
  key: string;
  label: string;
  format?: ValueFormat;
}

export type DataRow = Record<string, unknown>;

export type Visual =
  | {
      type: 'bar' | 'line' | 'area';
      title: string;
      xKey: string;
      series: SeriesDef[];
      data: DataRow[];
      format?: ValueFormat;
      stacked?: boolean;
    }
  | {
      type: 'pie';
      title: string;
      nameKey: string;
      valueKey: string;
      data: DataRow[];
      format?: ValueFormat;
    }
  | {
      type: 'table';
      title: string;
      columns: ColumnDef[];
      data: DataRow[];
    }
  | {
      type: 'cards';
      title?: string;
      items: { label: string; value: string | number; format?: ValueFormat; hint?: string }[];
    };
