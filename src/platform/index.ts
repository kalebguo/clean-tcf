import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

/**
 * Differences between the website and the iOS app (SPEC-IOS.md). Pages call these
 * functions and never import Capacitor themselves (SPEC-IOS §3 rule 2).
 */

/** True inside the iOS app, false on the website. */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/**
 * Hands a file to the user: a download on the website; in the app, which cannot
 * download, the share sheet (save to Files, AirDrop to the Mac). Returns false when
 * the user closed the share sheet without choosing anything.
 */
export async function saveFile(name: string, text: string, type: string): Promise<boolean> {
  if (!isNativeApp()) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    return true;
  }
  const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
  try {
    await Share.share({ files: [uri] });
    return true;
  } catch {
    return false; // cancelled
  }
}
