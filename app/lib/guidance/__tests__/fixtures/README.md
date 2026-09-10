# Madrid walking-route capture

`madrid-plaza-mayor.json` contains the actual ordered nodes returned by the app's
`fetchRoutingGraph → snapToGraph → dijkstra` pipeline on 2026-09-05. The inputs,
Overpass query, source timestamp, OSM node/way IDs and attribution are in the JSON.
The graph was loaded through Vite SSR; its relative fetch was remapped to an Overpass
response requested with a Umbra User-Agent. Shadow preference was zero. No nodes
were simplified, repositioned or synthesized, and endpoint connectors were not added.
This is a calculated OSM route, not a GPS recording or a claim of surveyed walkability.
Tests read the saved nodes and never fetch anything.

The 281 m walk goes west along Calle de Zaragoza, then right/north across Plaza Mayor
towards Calle de Felipe III. It turns left onto Calle Mayor, right onto Calle de
Coloreros, left into Plaza de San Ginés and right onto Calle de Bordadores. These five
turns, plus departure and arrival, are the expected list. The roughly 6 m left/right
offset at Calle Mayor is real in the captured graph and should survive: suppressing
all nearby maneuvers would lose it. Intermediate points along the same street should
not add instructions. The way names are provenance for this geometry check; B2 will
make them available to guidance at runtime.

To capture again, POST the recorded query to the recorded endpoint with a User-Agent,
load that response with `fetchRoutingGraph(40.414, -3.709, 40.418, -3.702)`, snap each
`requestedEndpoints` coordinate using `snapToGraph`, and call
`dijkstra(graph, startId, endId, 0)`. Map `result.nodeIds` through `graph.nodes` in order.
New OSM data may produce a different path; inspect its street transitions before
updating the fixture or expectations.
