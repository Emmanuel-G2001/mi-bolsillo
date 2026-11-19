export type AnalyticsType = "all" | "income" | "expense";

export type AnalyticsFilters = {
  startMonth: string;
  endMonth: string;
  type: AnalyticsType;
  category: string;
};

export type AnalyticsMetrics<T> = {
  income: T;
  expense: T;
  net: T;
  savings: T;
  available: T;
};

export type AnalyticsPoint = { month: string } & AnalyticsMetrics<string>;

export type AnalyticsResponse = {
  filters: AnalyticsFilters;
  categories: { id: string; name: string; type: "income" | "expense" }[];
  openingAvailable: string;
  hasFilteredMovements: boolean;
  series: AnalyticsPoint[];
  comparison: {
    current: AnalyticsPoint;
    previous: AnalyticsPoint;
    difference: AnalyticsMetrics<string>;
    percent: AnalyticsMetrics<string | null>;
  };
  distribution: {
    type: "income" | "expense";
    total: string;
    groups: { category: string; name: string; amount: string; percent: string }[];
  };
};
