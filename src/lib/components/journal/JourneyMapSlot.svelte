<script lang="ts">
	import type { MapMarker, MapRoute } from '$server/map/types';

	let { routeData = null, markers = [] }: { routeData?: MapRoute | null; markers?: MapMarker[] } = $props();
</script>

<section class="journey-slot" data-phase="3-map-seam" data-route-ready={routeData !== null} data-marker-count={markers.length}>
	<!-- Reserved for the Phase 3 journey experience; intentionally empty in this baseline. -->
</section>

<style>
	.journey-slot { width: 0; height: 0; min-width: 0; min-height: 0; overflow: hidden; }
</style>
