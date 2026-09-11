/**
 * Vercel serverless entry point for the shared Overpass proxy.
 *
 * The implementation also powers Vite's /__overpass middleware so local and
 * deployed routing use the same endpoint pool, retry budgets, `User-Agent`,
 * body limits, and cancellation behavior.
 */
export { handleOverpassRequest as default } from "../server/overpassProxy.js";
