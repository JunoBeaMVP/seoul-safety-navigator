import { describe, expect, it } from "vitest";
import { haversineMeters, inferActiveRisk, kmaGridFromLatLng, sortNearbyShelters, type Shelter } from "./safety";

describe("safety calculations", () => {
  it("converts a Seoul coordinate to the KMA forecast grid", () => {
    const grid = kmaGridFromLatLng(37.5665, 126.978);
    expect(grid).toEqual({ nx: 60, ny: 127 });
  });

  it("prioritizes official heavy-rain warnings over heat observations", () => {
    const risk = inferActiveRisk(
      [{ id: "rain", type: "rain", severity: "warning", title: "호우경보", summary: "", official: true }],
      { temperatureC: 35, rainfallMm: 2, humidityPct: 70, observedAt: "2026-08-15T00:00:00.000Z" }
    );
    expect(risk).toBe("rain");
  });

  it("sorts shelters by geographic distance without changing their source code", () => {
    const shelters: Shelter[] = [
      { id: "far", sourceCode: "OA-21065", riskType: "heatwave", name: "먼 쉼터", address: "서울", latitude: 37.59, longitude: 127.01, distanceMeters: 0 },
      { id: "near", sourceCode: "OA-21065", riskType: "heatwave", name: "가까운 쉼터", address: "서울", latitude: 37.567, longitude: 126.979, distanceMeters: 0 },
    ];
    const sorted = sortNearbyShelters(shelters, { latitude: 37.5665, longitude: 126.978 });
    expect(sorted.map(shelter => shelter.id)).toEqual(["near", "far"]);
    expect(sorted[0]?.sourceCode).toBe("OA-21065");
    expect(haversineMeters({ latitude: 37.5665, longitude: 126.978 }, { latitude: 37.567, longitude: 126.979 })).toBeLessThan(150);
  });
});
