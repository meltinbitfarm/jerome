# Storage adapter: MementoVault

Use this adapter when MementoVault's MCP tools are available in the session, or when `~/.config/jerome/config.json` sets `"storage": "mementovault"`.

Each project has its own collection in MementoVault, and the brief is the document titled exactly "Brief" in that collection. Document slugs are unique across the whole workspace, so the brief's slug may be `brief`, `brief-2` and so on: always find it by title, never by slug alone.

## Save

1. Look for an existing collection for the project (graph overview or search). If there is none, create it with the brief's slug.
2. List the collection's documents (`documents`, action `list`, with `collection` set to the project's slug). If one is titled "Brief", update it using its slug; otherwise create a document titled exactly "Brief" in that collection.
3. Documents accept about 4,000 characters per call: if the brief is longer, create it with the first part, then append the rest.
4. If MementoVault does not respond, show the brief in a markdown block to copy and say so clearly.

## Read (for import)

1. Find the project's collection by slug.
2. List its documents, take the one titled "Brief", get it by its slug and use the full content, front matter included.
