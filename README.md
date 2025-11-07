# Invisisnake

Turn-based Snake with a fading tail, power-ups, hazards, and crunchy chiptune FX. This repo is configured as a modern Vite + React project with Tailwind CSS for styling—perfect for a small indie game iteration loop.

## Getting Started

```bash
npm install
npm run dev
```

The dev server will open automatically. Use the arrow keys or on-screen D-pad to play.

## Available Scripts

- `npm run dev` – Start the Vite development server with fast HMR.
- `npm run build` – Create a production build in `dist/`.
- `npm run preview` – Preview the production build locally.

## Project Structure

```
public/          # Static assets (favicon, etc.)
src/
  App.jsx        # Root layout and page framing
  index.css      # Tailwind entry point + global styles
  main.jsx       # ReactDOM bootstrap
  components/
    Invisisnake.jsx # Full game implementation
```

Tailwind is configured in `tailwind.config.js` and PostCSS is set up via `postcss.config.cjs`.

## Styling

Tailwind utility classes are used throughout the UI. Edit `src/index.css` or extend the Tailwind config to tweak the look and feel.

## Building for Production

Run `npm run build` to create the optimized output. Deploy the `dist/` directory to any static host.
