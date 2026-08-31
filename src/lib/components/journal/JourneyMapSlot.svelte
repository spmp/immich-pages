<script lang="ts">
	import { onMount } from 'svelte';
	import type { MapMarker, MapRoute } from '$server/map/types';
	import { focusGalleryAsset, type MarkerActivation } from './map-focus';
	import 'maplibre-gl/dist/maplibre-gl.css';
	const MAX_COLLOCATED_LEAVES = 500;

	let { routeData = null, markers = [], enabled = false, activation = 'gallery', style, warnings = [] }: { routeData?: MapRoute | null; markers?: MapMarker[]; enabled?: boolean; activation?: MarkerActivation; style?: string; warnings?: string[] } = $props();
	let mapElement = $state<HTMLDivElement | undefined>(undefined);
	let mapStatus = $state<'disabled' | 'loading' | 'ready' | 'unavailable' | 'no-location'>('disabled');
	let clusterLeaves = $state<MapMarker[]>([]);
	let clusterMessage = $state('');
	const markerIds = $derived(new Set(markers.map((marker) => marker.id)));
	const hasLocation = $derived(markers.length > 0);
	const markerFeatures = $derived({ type: 'FeatureCollection', features: markers.map((marker) => ({ type: 'Feature', properties: { assetId: marker.id, label: marker.label ?? 'Photo location' }, geometry: { type: 'Point', coordinates: [marker.lon, marker.lat] } })) });
	const routeFeatures = $derived(routeData ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: routeData }] } : null);
	function activate(id: string) { return focusGalleryAsset(id, markerIds, activation); }
	function leafMarkers(features: any[]): MapMarker[] {
		return features.map((feature) => markers.find((marker) => marker.id === String(feature.properties?.assetId))).filter((marker): marker is MapMarker => Boolean(marker));
	}

		onMount(() => {
		if (!enabled) { mapStatus = 'disabled'; return; }
		if (!hasLocation) { mapStatus = 'no-location'; return; }
		mapStatus = 'loading';
		let map: any;
		let observer: ResizeObserver | undefined;
		let destroyed = false;
		const fail = () => { if (!destroyed) mapStatus = 'unavailable'; };
		void (async () => {
			try {
				if (!style) throw new Error('map-style-unavailable');
				const { Map, NavigationControl, LngLatBounds } = await import('maplibre-gl');
				if (destroyed) return;
				if (!mapElement) throw new Error('map-container-unavailable');
				map = new Map({ container: mapElement, style, center: [markers[0].lon, markers[0].lat], zoom: 3 });
				map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
				map.on('error', fail);
				map.on('webglcontextlost', fail);
				map.on('load', () => {
					if (destroyed) return;
					map.addSource('journey-markers', { type: 'geojson', data: markerFeatures, cluster: true, clusterRadius: 48, clusterMaxZoom: 14 });
					if (routeFeatures) { map.addSource('journey-route', { type: 'geojson', data: routeFeatures }); map.addLayer({ id: 'journey-route', type: 'line', source: 'journey-route', paint: { 'line-color': '#c96b4b', 'line-width': 3, 'line-opacity': 0.75, 'line-cap': 'round', 'line-join': 'round' } }); }
					map.addLayer({ id: 'journey-clusters', type: 'circle', source: 'journey-markers', filter: ['has', 'point_count'], paint: { 'circle-color': '#596b6a', 'circle-radius': 18, 'circle-opacity': 0.9 } });
					map.addLayer({ id: 'journey-cluster-count', type: 'symbol', source: 'journey-markers', filter: ['has', 'point_count'], layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12 }, paint: { 'text-color': '#fff' } });
					map.addLayer({ id: 'journey-points', type: 'circle', source: 'journey-markers', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': '#c96b4b', 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
					const bounds = markers.reduce((box: any, marker) => box.extend([marker.lon, marker.lat]), new LngLatBounds());
					map.fitBounds(bounds, { padding: 48, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600, maxZoom: 12 });
					map.on('click', 'journey-points', (event: any) => activate(event.features?.[0]?.properties?.assetId));
					map.on('click', 'journey-clusters', async (event: any) => {
						const feature = event.features?.[0]; const source = map.getSource('journey-markers'); if (!feature || !source) return;
						try {
							const count = Number(feature.properties?.point_count ?? 0);
							const leaves = leafMarkers(await source.getClusterLeaves(Number(feature.properties.cluster_id), MAX_COLLOCATED_LEAVES, 0));
							const collocated = leaves.length > 1 && leaves.every((leaf) => leaf.lat === leaves[0].lat && leaf.lon === leaves[0].lon);
							if (collocated) { clusterLeaves = leaves; clusterMessage = count > 500 ? 'collocated-marker-limit' : ''; return; }
							const zoom = await source.getClusterExpansionZoom(Number(feature.properties.cluster_id)); map.easeTo({ center: feature.geometry.coordinates, zoom });
						} catch { fail(); }
					});
					mapStatus = 'ready'; map.resize();
				});
				observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => map?.resize()); observer?.observe(mapElement);
			} catch { fail(); }
		})();
		return () => { destroyed = true; observer?.disconnect(); map?.remove(); };
	});
</script>

<section class:enabled class="journey-slot" data-phase="3-map-seam" data-route-ready={routeData !== null} data-marker-count={markers.length} aria-labelledby="journey-map-title">
	<h2 id="journey-map-title">Journey map</h2>
	{#if warnings.includes('map-source-unsupported')}<p role="status">Map route source is not supported yet; showing locations only.</p>{/if}
	{#if clusterMessage}<p role="status">{clusterMessage}</p>{/if}
	{#if mapStatus === 'no-location'}<p role="status">No location data is available for this journey.</p>{:else if mapStatus === 'unavailable'}<p role="status">Map unavailable; the narrative and gallery remain available.</p>{:else if enabled}<p class="map-status" role="status" aria-live="polite">{mapStatus === 'ready' ? 'Interactive journey map' : 'Loading journey map'}</p><div class="map" bind:this={mapElement} aria-hidden={mapStatus !== 'ready'}></div>{/if}
	{#if hasLocation}<nav class="marker-list" aria-label="Journey map locations"><h3>Photo locations</h3>{#each markers as marker}<button type="button" onclick={() => activate(marker.id)}>{marker.label ?? 'Photo location'}</button>{/each}</nav>{/if}
	{#if clusterLeaves.length}<section class="cluster-chooser" aria-labelledby="cluster-chooser-title"><h3 id="cluster-chooser-title">Choose a photo at this location</h3>{#each clusterLeaves as marker}<button type="button" onclick={() => activate(marker.id)}>{marker.label ?? 'Photo location'}</button>{/each}</section>{/if}
</section>

<style>
	.journey-slot { width: 100%; padding: 0; min-height: 0; overflow: hidden; }
	.journey-slot:not(.enabled) { width: 0; height: 0; }
	.journey-slot.enabled { padding: 32px 16px; background: #eeeae3; }
	.map { min-height: 280px; height: clamp(280px, 48vw, 560px); border-radius: 8px; overflow: hidden; background: #dfe3df; }
	.map-status { margin: 0 0 8px; color: #626860; }
	.marker-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
	.marker-list h3 { width: 100%; margin: 0; font-size: 14px; }
	.marker-list button { min-height: 44px; padding: 8px 12px; border: 1px solid #aeb8b1; border-radius: 999px; background: #fff; color: #202522; cursor: pointer; }
	.marker-list button:focus-visible { outline: 3px solid #c96b4b; outline-offset: 3px; }
	.cluster-chooser { margin-top: 16px; padding: 16px; border: 1px solid #c6c9c4; border-radius: 8px; background: #fff; }
	.cluster-chooser h3 { margin: 0 0 8px; font-size: 16px; }
	.cluster-chooser button { display: block; width: 100%; min-height: 44px; padding: 8px; border: 0; border-bottom: 1px solid #e1e3df; background: transparent; text-align: left; cursor: pointer; }
	.cluster-chooser button:focus-visible { outline: 3px solid #c96b4b; outline-offset: -3px; }
	@media (min-width: 640px) { .journey-slot.enabled { padding: 48px 24px; } }
	@media (min-width: 960px) { .journey-slot.enabled { padding-left: 32px; padding-right: 32px; } }
</style>
