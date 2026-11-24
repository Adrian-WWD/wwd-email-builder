# Templates

HTML snippets the builder drops into emails. Slots look like `%%NAME%%` so they never collide with EveryAction merge tags (`{{…}}`).

| File | Used for | Slots |
|---|---|---|
| `abx-cell.html` | One ActBlue Express button | `%%HREF%%` `%%LABEL%%` `%%COLOR%%` |
| `abx-row.html` | A row of one or two buttons | `%%CELLS%%` |
| `abx-ghost-mid.html` / `abx-ghost-end.html` | Outlook column fixes between and after the two buttons | none |
| `abx-row-separator.html` | Between rows of the grid | none |
| `abx-intro.html` | Small italic line above the grid | `%%TEXT%%` |
| `abx-grid.html` | The whole `[[ ABX ]]` block | `%%INTRO%%` `%%ROWS%%` |
| `single-button.html` | `[[ RUSH $5 NOW ]]` and `[[ DONATE ]]` | `%%ROW%%` |
| `image.html` | `[[ IMG ]]` slots | `%%HREF%%` `%%SRC%%` `%%ALT%%` `%%MAXWIDTH%%` (per-image width, or the campaign default) `%%BORDER%%` (empty unless the campaign sets a border) |

Change a file here and every campaign picks it up. Colors, labels and amounts come from the campaign JSON, not from these files.
