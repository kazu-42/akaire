import { writable } from "svelte/store";
import type { Annotation } from "./types";

// 現在のバージョン ID (URL から初期化)
export const versionId = writable<string>("");

// 全アノテーション (現バージョン全ページ)
export const annotations = writable<Annotation[]>([]);

// 現在選択中のアノテーション
export const activeAnnotationId = writable<string | null>(null);

// エラーメッセージ
export const errorMessage = writable<string | null>(null);
