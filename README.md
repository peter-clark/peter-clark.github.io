# neocorax.com

Personal site of Peter Clark — complex systems, statistical physics, and
interactive simulations. Jekyll, served by GitHub Pages.

Run locally with `bundle install` then `bundle exec jekyll serve`.

## Where things live

```
_config.yml            site settings, plugins, which effects to run
_data/                 content you edit without touching HTML
  nav.yml                the banner nav bar
  sidebar-left.yml       left sidebar panels
  sidebar-right.yml      right sidebar panels
_includes/             reusable fragments
  panel.html             renders one sidebar panel from a _data entry
  sidebar.html           renders a whole column of panels
_layouts/              page shells
  default.html           the frame every page sits in
  simulation.html        canvas + controls + graphs
_sass/                 stylesheet, one concern per file (see below)
assets/
  css/styles.scss        the manifest — imports everything in _sass
  images/panels/         images and gifs for sidebar panels
  js/                    background effects and the simulations
  theme/                 the frame art (banner, panel plates, fillers)
```

## Editing the sidebars

Both sidebars are data-driven. To add, remove, or reorder a panel, edit
`_data/sidebar-left.yml` or `_data/sidebar-right.yml` — no HTML involved. Each
entry can carry a title, a link, an image or gif, a caption, a paragraph, a list
of links, an embed, or raw HTML. The full key list is commented at the top of
`_data/sidebar-left.yml`.

Panel images go in `assets/images/panels/`.

## Stylesheet

`assets/css/styles.scss` is a manifest and nothing else; it imports the partials
in `_sass/` in cascade order:

| File | Holds |
|---|---|
| `settings.scss` | every shared width, colour, font and asset path |
| `base/reset.scss` | the CSS reset |
| `base/typography.scss` | element defaults and page prose |
| `layout/frame.scss` | the page frame and the three columns |
| `layout/effects.scss` | the animated background and banner layers |
| `components/button.scss` | `.btn3d` — the one button, at any size |
| `components/nav.scss` | the banner nav bar |
| `components/panel.scss` | sidebar panels and their content types |
| `components/menubox.scss` | the centre content box |
| `components/simulation.scss` | canvas, controls, graphs |
| `components/site-footer.scss` | the three footer columns |
| `components/blog.scss` | post listings and single posts |
| `utilities.scss` | small helper classes |

Two rules keep it tidy: change shared values in `settings.scss`, never inline;
and add a new component as its own file plus one line in the manifest.

### Buttons

Every button on the site is `.btn3d`. It is a pure-CSS rebuild of the theme's
original two-state sprite, so it stays crisp at any width instead of only at
90px. Components set the box (width, height, font size) and `@extend .btn3d`
for the bevel — they never restyle the bevel itself.

## Effects

`background_effect` and `banner_effect` in `_config.yml` name a file in
`assets/js/`. That script renders into `#bg-fx` and `#banner-fx-layer`
respectively, wired up by a `data-target` attribute. Set either to `false` to
turn it off.

## Simulations

A simulation is two files: `simulations/<name>/index.html` (front matter with
`layout: simulation` and `sim_id: <name>`) and
`assets/js/simulations/<name>.js`. Shared grid and render-loop helpers are in
`engine.js`. Set `plotly: true` in the front matter to pull in Plotly and
MathJax for live graphs.

## Credits

Frame art adapted from the DarkMech template. Syntax highlighting by
[prism.js](https://prismjs.com). Originally scaffolded from the LightSpeed
Jekyll theme (see `COPYING`).
