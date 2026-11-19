# Sci-Synth brand kit

The mark is a document page with a folded corner. A tall integral sign (∫) forms the page's spine.
Tagline: **"Hover any line of a paper. Understand it."**

All artwork is flat, filled vector paths. The wordmark is converted to outlines, so no font
needs to be installed. Every SVG and PNG has a transparent background, except the store and
social images and `apple-touch-icon.png`.

## Colours

| Role | Light theme | Dark theme (on `#0B0F1A`) |
| --- | --- | --- |
| Page, text lines, wordmark | Ink navy `#14213D` | Paper `#F3F1EA` |
| Integral ∫ and the hyphen in the wordmark | Teal `#1FB5A0` | Bright teal `#2FD3B9` |
| Background (store and social images only) | Off-white `#F7F5EF` | Night `#0B0F1A` |

Monochrome: everything is `#14213D`. Do not use gradients, shadows or outlines.

## Typography

- Wordmark: **IBM Plex Sans SemiBold**, "Sci-Synth", with the hyphen in teal. Tracking is −0.5 %.
- Tagline: IBM Plex Sans Regular at 78 % opacity.
- Licence: SIL Open Font License 1.1 (`OFL-IBM-Plex.txt`). The font files themselves are not included.

## Clear space and minimum size

- **Clear space:** keep an empty margin round the mark or lockup at least equal to the **width
  of the ∫**. This is about 41 % of the mark's height (52 of 128 units).
- **Minimum size:** use the mark at 16 px or larger. At 16 px use the pixel-hinted
  `sci-synth-mark-16.svg` / `-16.png`, and at 17–32 px use `sci-synth-mark-32.svg`. Use the
  horizontal lockup at 24 px tall or larger, and the stacked lockup at 64 px tall or larger.
- Do not stretch, rotate or recolour the mark, and do not separate the ∫ from the page.

## Files

This folder in the repository holds part of the kit: the SVGs, the lockup PNGs, the 128 and 512 px PNG marks and the light store tiles. The favicon files and the social image are in `docs/`, and the extension icons are in `public/icons/`. The list below describes the full kit.

```
icon/
  sci-synth-mark.svg            master mark, light (viewBox 0 0 128 128; 4 text lines)
  sci-synth-mark-dark.svg       for dark backgrounds
  sci-synth-mark-mono.svg       single colour #14213D
  sci-synth-mark-32.svg         tuned for 17–32 px (3 lines, heavier strokes)
  sci-synth-mark-16.svg         pixel-hinted 16 px (2 lines) – also -16-dark.svg
  sci-synth-mark-{16,32,48,64,128,256,512}.png        light
  sci-synth-mark-dark-{16,32,48,64,128,256,512}.png   dark
lockup/
  sci-synth-horizontal.svg / -dark.svg  + @2x.png
  sci-synth-stacked.svg    / -dark.svg  + @2x.png
store/   (Chrome Web Store; the light version is the primary one)
  promo-small-440x280.png   / -dark.png
  marquee-1400x560.png      / -dark.png
social/
  github-social-1280x640.png / -dark.png   (content within the central 1200×560 safe area)
favicon/
  favicon.svg            switches light/dark with prefers-color-scheme
  favicon.ico            16, 32, 48
  apple-touch-icon.png   180×180 on #F7F5EF
OFL-IBM-Plex.txt
```

## Construction (128 grid)

- Padding: 16. The artwork fills about x 17–108 and y 15–113.
- Page: outline stroke 8 with round joins and a 20-unit folded corner. Text lines are
  stroke 6 with round caps.
- ∫: a variable-width filled path. It is 2.6 units at the terminals and 11 units through the
  stem, and is point-symmetric about the centre of the stem. The hook curls over the page's
  top-left corner, and the tail extends below and to the left of the page.
