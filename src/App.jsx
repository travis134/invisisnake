import Invisisnake from './components/Invisisnake.jsx';

export default function App() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-start">
      <header className="w-full max-w-5xl px-6 pt-10 pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-100">Invisisnake</h1>
        <p className="mt-2 text-sm text-slate-300">
          A turn-based snake roguelite with fading tail, power-ups, hazards, and crunchy chiptune FX.
        </p>
      </header>
      <section className="w-full max-w-5xl px-6 pb-20">
        <Invisisnake />
      </section>
      <footer className="w-full max-w-5xl px-6 pb-10 text-xs text-slate-500">
        Crafted with React + Vite. Use arrow keys or the on-screen D-pad to survive the invisible serpent.
      </footer>
    </main>
  );
}
