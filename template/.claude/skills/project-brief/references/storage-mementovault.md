# Storage adapter: MementoVault

Use this adapter when MementoVault's MCP tools are available in the session, or when `~/.config/jerome/config.json` sets `"storage": "mementovault"`.

Each project has its own collection in MementoVault, and the brief is the collection's `brief` document.

## Save

1. Look for an existing collection for the project (graph overview or search). If there is none, create it with the brief's slug.
2. Save the brief as a document titled exactly "Brief", so its slug is `brief`. If it already exists, update it instead of creating a second one.
3. Documents accept about 4,000 characters per call: if the brief is longer, create it with the first part, then append the rest.
4. If MementoVault does not respond, show the brief in a markdown block to copy and say so clearly.

## Read (for import)

1. Find the project's collection by slug.
2. Get its `brief` document and use the full content, front matter included.
