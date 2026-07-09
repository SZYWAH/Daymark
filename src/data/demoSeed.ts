import {
  seedFoldersIfEmpty,
  seedItemsIfEmpty,
  seedJournalEntriesIfEmpty,
} from "./itemStore";

export async function seedDemoDataIfEmpty() {
  await Promise.all([seedItemsIfEmpty(), seedFoldersIfEmpty(), seedJournalEntriesIfEmpty()]);
}
