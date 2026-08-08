import { Link } from "react-router-dom";

export default function About() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-8 font-sans">
      <div className="max-w-2xl mx-auto">
        <Link
          to="/"
          className="text-white/40 text-sm hover:text-white/70 transition-colors mb-8 block"
        >
          ← Map
        </Link>

        <h1 className="text-3xl font-semibold mb-2">ShadeMapNav</h1>
        <p className="text-white/70 mb-4">
          A personal open-source shaded-route navigation project.
        </p>
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100 mb-10">
          ShadeMapNav is an independent personal project and is not affiliated with
          ShadeMap.app.
        </div>

        <section className="mb-10">
          <h2 className="text-xs font-semibold mb-4 text-white/80 uppercase tracking-wider">
            What It Does
          </h2>
          <ul className="space-y-2 text-sm text-white/60">
            <li>Simulates building shadows on a MapLibre map.</li>
            <li>Finds walking routes with shortest, balanced, and most-shaded options.</li>
            <li>Shows route tradeoffs such as added time and reduced sun exposure.</li>
            <li>Supports saved routes, shareable map links, and multi-stop route planning.</li>
            <li>Provides cloud-cover context so shaded routing is easier to trust.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xs font-semibold mb-4 text-white/80 uppercase tracking-wider">
            Built With
          </h2>
          <div className="space-y-3">
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <h3 className="font-medium mb-1">MapLibre GL</h3>
              <p className="text-sm text-white/50">
                Browser map rendering, camera controls, and vector tile display.
              </p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <h3 className="font-medium mb-1">mapbox-gl-shadow-simulator</h3>
              <p className="text-sm text-white/50">
                Local WebGL building-shadow simulation used by the app.
              </p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <h3 className="font-medium mb-1">OpenStreetMap and Open-Meteo</h3>
              <p className="text-sm text-white/50">
                Routing/search context and cloud-cover data for route planning.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-xs font-semibold mb-4 text-white/80 uppercase tracking-wider">
            Project Scope
          </h2>
          <p className="text-sm text-white/60">
            ShadeMapNav is experimental navigation software. Shadow, route, weather,
            and place data can be incomplete or delayed; use normal judgment outdoors.
          </p>
        </section>
      </div>
    </div>
  );
}
