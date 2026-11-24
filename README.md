# WWD Email Builder

Turns a campaign email draft (Google Doc template) into EveryAction-ready HTML: A/B versions per subject line, refcodes, ActBlue Express grids, NAME and $ASK merge tags, and linked ask lines.

## What lives where

```
index.html            the email builder
campaign-editor.html  form for making and editing campaign files
src/
  core.js             helpers, campaign defaults, loads campaigns + templates
  parse-doc.js        Google Doc / .docx / .pdf → draft details + email copy
  render.js           email copy → EveryAction HTML
  app.js              the builder interface
  editor.js           the campaign editor
  styles.css          WWD look
templates/            HTML snippets for buttons, grids and images (see templates/README.md)
campaigns/
  index.json          list of campaign files to load
  jake-johnson.json   one file per client
  _template.json      starting point for a new client
scripts/build.mjs     bundles everything into dist/email-builder.html
```

## Adding or changing a campaign

The easy way: open **Campaign editor** (top right of the builder, or `/campaign-editor.html`). Pick an existing campaign or start blank, fill in the form, check the sample preview, then **Add to GitHub** / **Update on GitHub**. For a new campaign it opens GitHub with the file already filled in, then walks you through adding it to `campaigns/index.json`.

By hand:

1. Copy `campaigns/_template.json` to `campaigns/<candidate-name>.json` and fill it in.
2. Add the file name to `campaigns/index.json`.
3. Open a pull request so someone can check it.

You can also fill a campaign out in the app (**New** or **Settings**), then use **Download JSON** and commit that file. Changes made in the app only last until the page reloads; the repo is the source of truth.

### Campaign fields

| Field | What it does |
|---|---|
| `name` | Shown in the picker; also matched against the draft’s title to pick the campaign automatically |
| `audience` | NAME fallback (“Team”, “friend”). Capitalized at the start of a sentence, lowercase mid-sentence |
| `mergeTag` | Name merge tag; `%FALLBACK%` is replaced with the audience word |
| `askMerge` | What `$ASK` becomes when the draft doesn’t give an amount (the HPC string) |
| `pages` | Donation pages (`name`, `url`); `defaultPage` is the index of the usual one |
| `refPattern` | Refcode; `%DATE%` = draft date as MM.DD.YY, `%V%` = a, b, c per subject line |
| `abx` | Express grid: `amounts`, button `label` (`%AMT%`), `otherLabel`, `color`, `otherColor`, `intro` |
| `donateLabel` | Text for `[[ DONATE ]]` |
| `image` | Default `maxWidth` for images (each email can override it per image) and an optional `border` (leave `""` for none) |
| `placeholders` | Custom tokens: `{ "token": "[[ SIG ]]", "html": "<p>…</p>" }` |

## Changing button or image markup

Edit the files in `templates/`. Slots look like `%%HREF%%` so they don’t collide with EveryAction merge tags.

## Running it

The page loads campaigns and templates with `fetch`, so it needs a web server rather than opening the file directly:

```
python3 -m http.server 8000
# then open http://localhost:8000
```

### GitHub Pages

Settings → Pages → Deploy from a branch → `main`, folder `/ (root)`. The site reads straight from `campaigns/` and `templates/`, so a merged pull request is live on the next deploy.

### Claude-hosted version

`node scripts/build.mjs` writes `dist/email-builder.html`, a single file with campaigns and templates baked in. That’s the version published as a Claude artifact. It’s the only version that can load a draft from a Google Doc link, because it uses the Google Drive connection in Claude. The GitHub Pages version imports .docx and .pdf, or you can paste the doc into Email copy.

After merging campaign or template changes, rebuild and republish the artifact (or send the repo to Claude to do it).

## Draft conventions

- Everything above `— BEGIN EMAIL DRAFT —` is the details table (Description, Sender, Subject lines, Ask, Segments, Date). Everything below is the email.
- Blue or underlined text becomes a bold link to the page being raised into, with the refcode.
- `[[ ABX ]]`, `[[ ABX 5, 25, 50 ]]`, `[[ RUSH $5 NOW ]]`, `[[ DONATE ]]`, `[[ IMG ]]`, `[[ HR ]]`, `NAME`, `NAME/team`, `$ASK`
- Lines starting with `DONOR:` / `NONDONOR:` produce a version per segment.
