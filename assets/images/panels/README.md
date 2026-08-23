# Panel images

Drop images and gifs for the sidebar panels in here, then point a panel at one
in `_data/sidebar-left.yml` or `_data/sidebar-right.yml`:

```yaml
- title: Diffusion
  image: /assets/images/panels/diffusion.gif
  caption: 200×200 lattice, 10k walkers
  pixelated: true
```

The panel is 150px wide inside; the image scales to fit and keeps its aspect
ratio, so any source size works. `pixelated: true` turns off smoothing, which
looks better for pixel art and small lattice gifs.
