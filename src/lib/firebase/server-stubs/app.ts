import { browserOnly } from "./shared";

export const getApp = () => browserOnly("getApp");
export const getApps = () => browserOnly("getApps");
export const initializeApp = () => browserOnly("initializeApp");
