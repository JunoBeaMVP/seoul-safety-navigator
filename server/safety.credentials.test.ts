import { describe, expect, it } from "vitest";
import { getCurrentWeather, getNearbyShelters, getSafetySnapshot, getWalkingRoute } from "./safety";

const cityHall = { latitude: 37.5665, longitude: 126.978 };

describe("server API credentials", () => {
  it("retrieves a KMA safety snapshot using the server-only service key", async () => {
    expect(process.env.KMA_SERVICE_KEY).toBeTruthy();
    const weather = await getCurrentWeather(cityHall.latitude, cityHall.longitude);
    expect(weather.temperatureC).not.toBeNull();
    const snapshot = await getSafetySnapshot(cityHall.latitude, cityHall.longitude);
    expect(snapshot.configuration.weather).toBe(true);
    expect(snapshot.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snapshot.weather?.temperatureC).not.toBeNull();
  }, 20_000);

  it("retrieves official Seoul heatwave shelters using the server-only open API key", async () => {
    expect(process.env.SEOUL_OPEN_API_KEY).toBeTruthy();
    const shelters = await getNearbyShelters(cityHall.latitude, cityHall.longitude, "heatwave");
    expect(shelters.length).toBeGreaterThan(0);
    expect(shelters[0]?.sourceCode).toBe("OA-21065");
  }, 20_000);

  it("retrieves flood and civil-defense shelters from their prescribed official data sources", async () => {
    const [floodShelters, civilShelters] = await Promise.all([
      getNearbyShelters(cityHall.latitude, cityHall.longitude, "rain"),
      getNearbyShelters(cityHall.latitude, cityHall.longitude, "civil"),
    ]);
    expect(floodShelters.length).toBeGreaterThan(0);
    expect(floodShelters[0]?.sourceCode).toBe("OA-21181");
    expect(civilShelters.length).toBeGreaterThan(0);
    expect(civilShelters[0]?.sourceCode).toBe("LOCALDATA_114602");
  }, 30_000);

  it("retrieves a walking route using the server-only OpenRouteService key", async () => {
    expect(process.env.OPENROUTE_SERVICE_KEY).toBeTruthy();
    const route = await getWalkingRoute(cityHall, { latitude: 37.5656, longitude: 126.9779 });
    expect(route.distanceMeters).toBeGreaterThan(0);
    expect(route.durationSeconds).toBeGreaterThan(0);
    expect(route.coordinates.length).toBeGreaterThan(1);
  }, 20_000);
});
