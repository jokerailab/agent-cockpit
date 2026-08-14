# Screenshot harness

The screenshots in the README are rendered from these static HTML files, not
captured from a running app.

**Why.** A real screenshot of Agent Cockpit shows real project names, real
branches and real task descriptions taken from the author's machine. Publishing
those leaks work in progress and client names. These files use the app's actual
stylesheets (`src/renderer/src/styles/`) with fabricated data, so the result is
visually identical to the product but contains nothing private.

If you change the UI and want to refresh the screenshots, edit the HTML here and
re-render. Do not paste a screenshot of your own session into a PR.

## Files

| Mock | Output | Shows |
| --- | --- | --- |
| `audit.html` | `docs/screenshots/01-health-audit.png` | Session audit: scores, diagnoses, advice |
| `cards.html` | `docs/screenshots/02-session-cards.png` | Session cards: health banner, context, token mix, burn rate |
| `popover.html` | `docs/screenshots/03-popover.png` | Menu-bar popover: review queue, quota, alerts |

Each file links the real `tokens.css` plus the relevant component stylesheet by
relative path, then neutralises entrance animations and modal backdrops so the
capture is static. Fonts come from Google Fonts, so rendering needs network
access; without it the layout is correct but the typefaces fall back.

## Re-rendering

Headless Chrome, at 2× for a crisp result:

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"   # macOS
# CHROME=google-chrome                                                  # Linux

shot() {  # shot <mock> <output> <width> <height>
  "$CHROME" --headless --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=2 --virtual-time-budget=4000 \
    --window-size="$3,$4" --screenshot="$2" "file://$PWD/docs/mock/$1"
}

shot audit.html    docs/screenshots/01-health-audit.png  620 815
shot cards.html    docs/screenshots/02-session-cards.png 505 712
shot popover.html  docs/screenshots/03-popover.png       490 520
```

`--virtual-time-budget` gives the webfonts time to load; without it you get
fallback typefaces. The window sizes are tuned to frame the content with even
margins, so adjust them if you add or remove rows.

## Keeping copy in sync

The mock text is duplicated from `src/shared/i18n/en.ts`. It is not generated, so
if you change a user-facing string that appears in a screenshot, update the mock
too. Nothing enforces this, which is why the mocks are deliberately small.
