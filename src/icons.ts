// One symbol per thing, used everywhere (Lucide): the same picture always means the same.
import { Archive, Bell, Camera, Check, CheckCheck, ClipboardList, File, FileImage, FileSpreadsheet, FileText, Footprints, Inbox, ListChecks, Mic,
  Paperclip, Receipt, Star, Trash2, X, type LucideIcon } from 'lucide-react';

export const SYMBOL = {
  postfach: Inbox, archiv: Archive, rechnung: Receipt, foto: Camera, aufgabe: ListChecks, glocke: Bell, papierkorb: Trash2,
  entfernen: X, erledigt: Check, alleGelesen: CheckCheck, begehung: Footprints, sprachnotiz: Mic, ablauf: ClipboardList, stern: Star,
} satisfies Record<string, LucideIcon>;

// A file by its kind (for documents without a preview picture).
export const dateiSymbol = (datei: string): LucideIcon => (/\.pdf$/i.test(datei) ? FileText : /\.(docx?|odt|txt)$/i.test(datei) ? File
  : /\.(xlsx?|ods|csv)$/i.test(datei) ? FileSpreadsheet : /\.(png|jpe?g|gif|webp|heic)$/i.test(datei) ? FileImage : Paperclip);
