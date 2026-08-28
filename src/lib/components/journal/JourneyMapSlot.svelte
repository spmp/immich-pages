<script lang="ts">
	let { routeData = null, markers = [] }: { routeData?: null; markers?: [] } = $props();
</script>

<section class="journey-slot" aria-label="Journey map extension point" data-route-ready={routeData !== null} data-marker-count={markers.length}>
	<!-- Reserved for the Phase 3 journey experience; intentionally empty in this baseline. -->
</section>

<style>
	.journey-slot { min-height: 0; }
</style>
