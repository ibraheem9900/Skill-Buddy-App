import React, { createContext, useContext, useState, useCallback } from 'react';

export interface ServiceFilters {
  categoryId: string | null; // null = All
  minPrice: number;
  maxPrice: number;
  minRating: number | null;
  date: string | null;
}

export const DEFAULT_FILTERS: ServiceFilters = {
  categoryId: null,
  minPrice: 20,
  maxPrice: 200,
  minRating: null,
  date: null,
};

interface FilterContextType {
  filters: ServiceFilters;
  setFilters: (f: ServiceFilters) => void;
  resetFilters: () => void;
  activeCount: number;
}

const FilterContext = createContext<FilterContextType>({
  filters: DEFAULT_FILTERS,
  setFilters: () => {},
  resetFilters: () => {},
  activeCount: 0,
});

function countActive(f: ServiceFilters): number {
  let n = 0;
  if (f.categoryId) n++;
  if (f.minPrice !== DEFAULT_FILTERS.minPrice || f.maxPrice !== DEFAULT_FILTERS.maxPrice) n++;
  if (f.minRating) n++;
  if (f.date) n++;
  return n;
}

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [filters, setFiltersState] = useState<ServiceFilters>(DEFAULT_FILTERS);

  const setFilters = useCallback((f: ServiceFilters) => setFiltersState(f), []);
  const resetFilters = useCallback(() => setFiltersState(DEFAULT_FILTERS), []);

  return (
    <FilterContext.Provider value={{ filters, setFilters, resetFilters, activeCount: countActive(filters) }}>
      {children}
    </FilterContext.Provider>
  );
}

export function useServiceFilters() {
  return useContext(FilterContext);
}
