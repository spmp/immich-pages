export type MapWarning = 'map-marker-limit' | 'collocated-marker-limit' | 'map-source-unsupported' | 'map-no-location' | 'map-style-unavailable' | 'map-route-limit' | 'map-route-invalid' | 'brouter-permalink-invalid' | 'brouter-permalink-unsupported' | 'brouter-profile-unsupported' | 'brouter-endpoint-unsafe' | 'brouter-route-rejected' | 'brouter-request-failed' | 'brouter-response-invalid' | 'brouter-response-too-large' | 'brouter-timeout';

export type MapMarker = {
	id: string;
	lat: number;
	lon: number;
	label?: string;
};

export type MapRoute =
	| { type: 'LineString'; coordinates: Array<[number, number]> }
	| { type: 'MultiLineString'; coordinates: Array<Array<[number, number]>> };

export type PathResult =
	| { kind: 'resolved'; route: MapRoute; warnings: MapWarning[] }
	| { kind: 'unavailable'; warnings: MapWarning[] };

export type MapModel = {
	enabled: boolean;
	markers: MapMarker[];
	routeData: MapRoute | null;
	warnings: MapWarning[];
	style?: { name: 'quiet-atlas'; url: string };
};
