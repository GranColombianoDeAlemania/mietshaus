// Names of the database functions the renderer may call, taken from electron/db.cjs: a misspelt name in call('…')
// fails the type check instead of failing at run time with "Unbekannte Funktion".
import type { api } from '../electron/db.cjs';

export type DbApi = ReturnType<typeof api>;
export type DbFn = { [K in keyof DbApi]: DbApi[K] extends (...a: never[]) => unknown ? K : never }[keyof DbApi] & string;
