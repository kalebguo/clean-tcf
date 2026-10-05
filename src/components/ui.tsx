import { createContext, useContext } from "react";

export interface UI {
  openSettings(): void;
  openSearch(initial?: string): void;
  toggleDict(): void;
  closeDict(): void;
}

export const UIContext = createContext<UI>({ openSettings() {}, openSearch() {}, toggleDict() {}, closeDict() {} });

export const useUI = () => useContext(UIContext);
