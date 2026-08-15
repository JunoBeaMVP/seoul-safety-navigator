import { useEffect } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import type { Shelter, WalkingRoute } from "../../../server/safety";
import "leaflet/dist/leaflet.css";

type LatLng = { latitude: number; longitude: number };

function MapFocus({ location }: { location: LatLng }) {
  const map = useMap();
  useEffect(() => {
    if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return;
    map.flyTo([location.latitude, location.longitude], 14, { duration: 0.75 });
  }, [location.latitude, location.longitude, map]);
  return null;
}

function sourceColor(sourceCode: Shelter["sourceCode"]) {
  if (sourceCode === "OA-21065") return "#f59e0b";
  if (sourceCode === "OA-21181") return "#0ea5e9";
  return "#7357d8";
}

export function SafetyMap({
  location,
  shelters,
  selectedShelter,
  route,
}: {
  location: LatLng;
  shelters: Shelter[];
  selectedShelter: Shelter | null;
  route: WalkingRoute | null;
}) {
  return (
    <div className="map-shell" aria-label="OpenStreetMap 기반 대피소 지도">
      <MapContainer
        center={[location.latitude, location.longitude]}
        zoom={14}
        scrollWheelZoom
        className="safety-map"
        zoomControl={false}
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>'
        />
        <MapFocus location={location} />
        <CircleMarker
          center={[location.latitude, location.longitude]}
          radius={10}
          pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#111f3d", fillOpacity: 1 }}
        >
          <Popup>현재 위치</Popup>
        </CircleMarker>
        {shelters.map(shelter => (
          <CircleMarker
            key={shelter.id}
            center={[shelter.latitude, shelter.longitude]}
            radius={selectedShelter?.id === shelter.id ? 11 : 8}
            pathOptions={{
              color: "#ffffff",
              weight: selectedShelter?.id === shelter.id ? 3 : 2,
              fillColor: sourceColor(shelter.sourceCode),
              fillOpacity: 1,
            }}
          >
            <Popup>
              <strong>{shelter.name}</strong>
              <br />
              {shelter.address}
            </Popup>
          </CircleMarker>
        ))}
        {route?.coordinates?.length ? (
          <Polyline positions={route.coordinates} pathOptions={{ color: "#111f3d", weight: 5, opacity: 0.85 }} />
        ) : null}
      </MapContainer>
      <div className="map-legend" aria-label="지도 범례">
        <span><i className="legend-dot current" />현재 위치</span>
        <span><i className="legend-dot heat" />무더위쉼터</span>
        <span><i className="legend-dot rain" />수해대피소</span>
        <span><i className="legend-dot civil" />민방위대피시설</span>
      </div>
    </div>
  );
}
