export type MapWarning = 'map-marker-limit' | 'collocated-marker-limit' | 'map-source-unsupported' | 'map-no-location' | 'map-style-unavailable' | 'map-route-limit';

export type MapMarker = {
	id: string;
	lat: number;
	lon: number;
	label?: string;
};

export type MapRoute = {
	type: 'LineString';
	coordinates: Array<[number, number]>;
};

export type MapModel = {
	enabled: boolean;
	markers: MapMarker[];
	routeData: MapRoute | null;
	warnings: MapWarning[];
	style?: { name: 'quiet-atlas'; url: string };
};
