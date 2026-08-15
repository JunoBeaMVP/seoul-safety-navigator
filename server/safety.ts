import * as XLSX from "xlsx";
import proj4 from "proj4";
import * as db from "./db";

export type RiskType = "heatwave" | "rain" | "civil";
export type AlertSeverity = "watch" | "warning";

export type SafetyAlert = {
  id: string;
  type: Exclude<RiskType, "civil">;
  severity: AlertSeverity;
  title: string;
  summary: string;
  official: boolean;
};

export type WeatherReading = {
  temperatureC: number | null;
  rainfallMm: number | null;
  humidityPct: number | null;
  observedAt: string;
};

export type Shelter = {
  id: string;
  sourceCode: "OA-21065" | "OA-21181" | "LOCALDATA_114602";
  riskType: RiskType;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  capacity?: string;
  note?: string;
};

export type WalkingRoute = {
  distanceMeters: number;
  durationSeconds: number;
  coordinates: Array<[number, number]>;
};

export type SafetySnapshot = {
  generatedAt: string;
  weather: WeatherReading | null;
  alerts: SafetyAlert[];
  activeRisk: RiskType;
  configuration: {
    weather: boolean;
    shelters: boolean;
    routing: boolean;
  };
  sourceMessage?: string;
};

const KMA_FORECAST_URL =
  "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst";
const KMA_WARNING_URL =
  "https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList";
// The official Seoul Open API documentation exposes port 8088 over HTTP.
// Requests stay server-side, so the application key is never in a browser URL.
const SEOUL_OPEN_API_URL = "http://openapi.seoul.go.kr:8088";
const FLOOD_FILE_URL =
  "https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?useCache=false";
const SEOUL_CENTER = { latitude: 37.5665, longitude: 126.978 };
const SEOUL_BOUNDS = {
  minLat: 37.42,
  maxLat: 37.72,
  minLng: 126.75,
  maxLng: 127.2,
};

const PROJ_5174 =
  "+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=-146.43,507.89,681.46 +units=m +no_defs";
const PROJ_5186 =
  "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs";

proj4.defs("EPSG:5174", PROJ_5174);
proj4.defs("EPSG:5186", PROJ_5186);

let shelterCache: { expiresAt: number; key: RiskType; shelters: Shelter[] } | null = null;
let latestSnapshot: SafetySnapshot | null = null;
let snapshotExpiresAt = 0;

function ensureSeoulCoordinate(latitude: number, longitude: number) {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < SEOUL_BOUNDS.minLat ||
    latitude > SEOUL_BOUNDS.maxLat ||
    longitude < SEOUL_BOUNDS.minLng ||
    longitude > SEOUL_BOUNDS.maxLng
  ) {
    throw new Error("서울시 범위 안의 좌표만 조회할 수 있습니다.");
  }
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const numberValue = Number(value.replace(/,/g, ""));
    return Number.isFinite(numberValue) ? numberValue : null;
  }
  return null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

function pick(row: Record<string, unknown>, candidates: string[]) {
  for (const candidate of candidates) {
    const direct = asText(row[candidate]);
    if (direct) return direct;
    const actualKey = Object.keys(row).find(key => key.toUpperCase() === candidate.toUpperCase());
    if (actualKey) {
      const value = asText(row[actualKey]);
      if (value) return value;
    }
  }
  return "";
}

function withTimeout(ms = 12_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

async function fetchJson(url: URL, init?: RequestInit) {
  const timeout = withTimeout();
  try {
    const response = await fetch(url, { ...init, signal: timeout.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`외부 데이터 응답 오류 (${response.status}): ${text.slice(0, 260)}`);
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`외부 데이터가 JSON 형식이 아닙니다: ${text.slice(0, 260)}`);
    }
  } finally {
    timeout.clear();
  }
}

function normalizeKmaServiceKey(rawKey: string) {
  try {
    return rawKey.includes("%") ? decodeURIComponent(rawKey) : rawKey;
  } catch {
    return rawKey;
  }
}

function kmaUrl(endpoint: string, params: Record<string, string>) {
  const url = new URL(endpoint);
  const serviceKey = normalizeKmaServiceKey(requiredEnv("KMA_SERVICE_KEY"));
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("dataType", "JSON");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

export function kmaGridFromLatLng(latitude: number, longitude: number) {
  const RE = 6371.00877;
  const GRID = 5.0;
  const SLAT1 = 30.0;
  const SLAT2 = 60.0;
  const OLON = 126.0;
  const OLAT = 38.0;
  const XO = 43;
  const YO = 136;
  const DEGRAD = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;
  const sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) /
    Math.log(Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5));
  const sf = Math.pow(Math.tan(Math.PI * 0.25 + slat1 * 0.5), sn) * Math.cos(slat1) / sn;
  const ro = re * sf / Math.pow(Math.tan(Math.PI * 0.25 + olat * 0.5), sn);
  const ra = re * sf / Math.pow(Math.tan(Math.PI * 0.25 + latitude * DEGRAD * 0.5), sn);
  let theta = longitude * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;
  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}

function kmaBaseTime() {
  const now = new Date(Date.now() - 45 * 60_000);
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const time = `${String(now.getHours()).padStart(2, "0")}00`;
  return { baseDate: date, baseTime: time };
}

function findItems(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.flatMap(entry => findItems(entry));
  }
  if (!value || typeof value !== "object") return [];
  const objectValue = value as Record<string, unknown>;
  const item = objectValue.item;
  if (Array.isArray(item)) return item.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object");
  return Object.values(objectValue).flatMap(entry => findItems(entry));
}

export async function getCurrentWeather(latitude: number, longitude: number): Promise<WeatherReading> {
  const { nx, ny } = kmaGridFromLatLng(latitude, longitude);
  const { baseDate, baseTime } = kmaBaseTime();
  const url = kmaUrl(KMA_FORECAST_URL, {
    numOfRows: "100",
    pageNo: "1",
    base_date: baseDate,
    base_time: baseTime,
    nx: String(nx),
    ny: String(ny),
  });
  const payload = await fetchJson(url);
  const records = findItems(payload);
  const byCategory = new Map(records.map(record => [asText(record.category), asText(record.obsrValue)]));
  return {
    temperatureC: asNumber(byCategory.get("T1H")),
    rainfallMm: asNumber(byCategory.get("RN1")),
    humidityPct: asNumber(byCategory.get("REH")),
    observedAt: new Date().toISOString(),
  };
}

function warningFromRecord(record: Record<string, unknown>, index: number): SafetyAlert | null {
  const text = Object.values(record).map(asText).join(" ");
  const type: SafetyAlert["type"] | null = text.includes("폭염") ? "heatwave" : text.includes("호우") ? "rain" : null;
  if (!type) return null;
  const severity: AlertSeverity = text.includes("경보") ? "warning" : "watch";
  const title = text.match(/[^\n]{0,16}(폭염|호우)(주의보|경보)[^\n]{0,24}/)?.[0]?.trim() || `${type === "heatwave" ? "폭염" : "호우"} ${severity === "warning" ? "경보" : "주의보"}`;
  return {
    id: `kma-${type}-${index}-${title}`,
    type,
    severity,
    title,
    summary: "기상청 특보 조회 결과입니다. 현장 안내와 재난문자를 우선 확인해 주세요.",
    official: true,
  };
}

async function getWarnings(): Promise<SafetyAlert[]> {
  const today = new Date();
  const date = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const url = kmaUrl(KMA_WARNING_URL, {
    numOfRows: "100",
    pageNo: "1",
    fromTmFc: date,
    toTmFc: date,
  });
  const payload = await fetchJson(url);
  return findItems(payload)
    .map(warningFromRecord)
    .filter((alert): alert is SafetyAlert => alert !== null);
}

export function inferActiveRisk(alerts: SafetyAlert[], weather: WeatherReading | null): RiskType {
  if (alerts.some(alert => alert.type === "rain" && alert.severity === "warning")) return "rain";
  if (alerts.some(alert => alert.type === "heatwave" && alert.severity === "warning")) return "heatwave";
  if (weather?.rainfallMm && weather.rainfallMm > 0) return "rain";
  if (weather?.temperatureC && weather.temperatureC >= 33) return "heatwave";
  return "heatwave";
}

function addObservationAlerts(alerts: SafetyAlert[], weather: WeatherReading | null): SafetyAlert[] {
  if (!weather) return alerts;
  const result = [...alerts];
  if (weather.temperatureC !== null && weather.temperatureC >= 33 && !alerts.some(alert => alert.type === "heatwave")) {
    result.push({
      id: "observation-heat",
      type: "heatwave",
      severity: "watch",
      title: `기온 ${weather.temperatureC.toFixed(1)}°C: 폭염 주의`,
      summary: "관측 기온에 따른 보조 안내입니다. 공식 특보 발효 여부는 기상청 특보를 기준으로 합니다.",
      official: false,
    });
  }
  if (weather.rainfallMm !== null && weather.rainfallMm > 0 && !alerts.some(alert => alert.type === "rain")) {
    result.push({
      id: "observation-rain",
      type: "rain",
      severity: "watch",
      title: `시간 강수량 ${weather.rainfallMm.toFixed(1)}mm: 비가 내리고 있습니다`,
      summary: "저지대·지하차도·하천변 접근을 피하고 공식 재난 안내를 확인해 주세요.",
      official: false,
    });
  }
  return result;
}

function parseSnapshot(payload: string): SafetySnapshot | null {
  try {
    const value = JSON.parse(payload) as SafetySnapshot;
    return value && Array.isArray(value.alerts) ? value : null;
  } catch {
    return null;
  }
}

export async function refreshSafetySnapshot(latitude = SEOUL_CENTER.latitude, longitude = SEOUL_CENTER.longitude): Promise<SafetySnapshot> {
  const configuration = {
    weather: Boolean(process.env.KMA_SERVICE_KEY),
    shelters: Boolean(process.env.SEOUL_OPEN_API_KEY),
    routing: Boolean(process.env.OPENROUTE_SERVICE_KEY),
  };
  if (!configuration.weather) {
    const missing: SafetySnapshot = {
      generatedAt: new Date().toISOString(),
      weather: null,
      alerts: [],
      activeRisk: "heatwave",
      configuration,
      sourceMessage: "기상청 서비스키를 설정하면 실시간 특보와 초단기실황을 표시합니다.",
    };
    latestSnapshot = missing;
    snapshotExpiresAt = Date.now() + 60_000;
    return missing;
  }
  const [weatherResult, warningsResult] = await Promise.allSettled([
    getCurrentWeather(latitude, longitude),
    getWarnings(),
  ]);
  const weather = weatherResult.status === "fulfilled" ? weatherResult.value : null;
  const officialAlerts = warningsResult.status === "fulfilled" ? warningsResult.value : [];
  const alerts = addObservationAlerts(officialAlerts, weather);
  const snapshot: SafetySnapshot = {
    generatedAt: new Date().toISOString(),
    weather,
    alerts,
    activeRisk: inferActiveRisk(alerts, weather),
    configuration,
    sourceMessage:
      weatherResult.status === "rejected" || warningsResult.status === "rejected"
        ? "일부 기상 데이터를 가져오지 못했습니다. 잠시 후 다시 확인해 주세요."
        : undefined,
  };
  latestSnapshot = snapshot;
  snapshotExpiresAt = Date.now() + 3 * 60_000;
  await db.saveWeatherSnapshot(JSON.stringify(snapshot));
  return snapshot;
}

export async function getSafetySnapshot(latitude: number, longitude: number): Promise<SafetySnapshot> {
  ensureSeoulCoordinate(latitude, longitude);
  if (latestSnapshot && Date.now() < snapshotExpiresAt) return latestSnapshot;
  const persisted = await db.getLatestWeatherSnapshot();
  if (persisted && Date.now() - persisted.collectedAt.getTime() < 3 * 60_000) {
    const parsed = parseSnapshot(persisted.payload);
    if (parsed) return parsed;
  }
  return refreshSafetySnapshot(latitude, longitude);
}

function transformToWgs84(epsg: "EPSG:5174" | "EPSG:5186", x: number, y: number) {
  const [longitude, latitude] = proj4(epsg, "WGS84", [x, y]);
  return { latitude, longitude };
}

export function haversineMeters(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
  const R = 6_371_000;
  const dLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const dLng = ((to.longitude - from.longitude) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((from.latitude * Math.PI) / 180) * Math.cos((to.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function defaultLocation(row: Record<string, unknown>, epsg: "EPSG:5174" | "EPSG:5186") {
  const latitude = asNumber(pick(row, ["LAT", "Y_WGS84", "YCORD", "위도"]));
  const longitude = asNumber(pick(row, ["LON", "X_WGS84", "XCORD", "경도"]));
  if (latitude !== null && longitude !== null) return { latitude, longitude };
  // LOCALDATA_114602 currently returns XCRD=latitude and YCRD=longitude
  // despite the dataset's legacy projected-coordinate description.
  const localDataLatitude = asNumber(pick(row, ["XCRD"]));
  const localDataLongitude = asNumber(pick(row, ["YCRD"]));
  if (
    localDataLatitude !== null &&
    localDataLongitude !== null &&
    localDataLatitude > 30 &&
    localDataLatitude < 40 &&
    localDataLongitude > 120 &&
    localDataLongitude < 130
  ) {
    return { latitude: localDataLatitude, longitude: localDataLongitude };
  }
  const x = asNumber(pick(row, ["XCRD", "MAP_COORD_X", "X", "X좌표"]));
  const y = asNumber(pick(row, ["YCRD", "MAP_COORD_Y", "Y", "Y좌표"]));
  if (x === null || y === null) return null;
  return transformToWgs84(epsg, x, y);
}

function isMapLocation(location: { latitude: number; longitude: number } | null): location is { latitude: number; longitude: number } {
  return Boolean(
    location &&
      location.latitude >= SEOUL_BOUNDS.minLat &&
      location.latitude <= SEOUL_BOUNDS.maxLat &&
      location.longitude >= SEOUL_BOUNDS.minLng &&
      location.longitude <= SEOUL_BOUNDS.maxLng
  );
}

async function seoulRows(service: string) {
  const key = requiredEnv("SEOUL_OPEN_API_KEY");
  const rows: Array<Record<string, unknown>> = [];
  let start = 1;
  let total = 1;
  while (start <= total && start <= 10_000) {
    const end = start + 999;
    const url = new URL(`${SEOUL_OPEN_API_URL}/${encodeURIComponent(key)}/json/${service}/${start}/${end}/`);
    const payload = await fetchJson(url);
    const body = payload[service] as Record<string, unknown> | undefined;
    const pageRows = Array.isArray(body?.row) ? body.row : [];
    total = asNumber(body?.list_total_count) ?? pageRows.length;
    rows.push(...(pageRows as Array<Record<string, unknown>>));
    if (!pageRows.length) break;
    start = end + 1;
  }
  return rows;
}

async function heatwaveShelters(): Promise<Shelter[]> {
  const rows = await seoulRows("TbGtnHwcwP");
  return rows.flatMap((row, index) => {
    const location = defaultLocation(row, "EPSG:5186");
    if (!isMapLocation(location)) return [];
    return [{
      id: `heat-${index}-${pick(row, ["R_AREA_NM", "쉼터명칭"])}`,
      sourceCode: "OA-21065" as const,
      riskType: "heatwave" as const,
      name: pick(row, ["R_AREA_NM", "쉼터명칭"]) || "무더위쉼터",
      address: pick(row, ["R_DETL_ADD", "LOTNO_ADDR", "도로명주소", "지번주소"]) || "주소 정보 없음",
      latitude: location.latitude,
      longitude: location.longitude,
      distanceMeters: 0,
      capacity: pick(row, ["USE_PRNB", "이용가능인원"]),
      note: pick(row, ["FACILITY_TYPE1", "FACILITY_TYPE2", "RMRK", "비고"]),
    }];
  });
}

async function civilShelters(): Promise<Shelter[]> {
  const rows = await seoulRows("LOCALDATA_114602");
  return rows.flatMap((row, index) => {
    const location = defaultLocation(row, "EPSG:5174");
    if (!isMapLocation(location)) return [];
    return [{
      id: `civil-${index}-${pick(row, ["BPLC_NM", "사업장명"])}`,
      sourceCode: "LOCALDATA_114602" as const,
      riskType: "civil" as const,
      name: pick(row, ["BPLC_NM", "사업장명"]) || "민방위대피시설",
      address: pick(row, ["ROAD_NM_ADDR", "LOTNO_ADDR", "도로명주소", "지번주소"]) || "주소 정보 없음",
      latitude: location.latitude,
      longitude: location.longitude,
      distanceMeters: 0,
      note: pick(row, ["DTL_SALS_STTS_NM", "상세영업상태명"]),
    }];
  });
}

async function floodShelters(): Promise<Shelter[]> {
  const timeout = withTimeout();
  try {
    const response = await fetch(FLOOD_FILE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ infId: "OA-21181", seq: "5", infSeq: "2" }).toString(),
      signal: timeout.signal,
    });
    if (!response.ok) throw new Error(`수해대피소 파일 응답 오류 (${response.status})`);
    const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: "" });
    return rows.flatMap((row, index) => {
      const location = defaultLocation(row, "EPSG:5186");
      if (!isMapLocation(location)) return [];
      return [{
        id: `flood-${index}-${pick(row, ["EQUP_NM", "FCLT_NM", "SHELTER_NM", "NAME", "시설명", "대피소명"])}`,
        sourceCode: "OA-21181" as const,
        riskType: "rain" as const,
        name: pick(row, ["EQUP_NM", "FCLT_NM", "SHELTER_NM", "NAME", "시설명", "대피소명"]) || "수해대피소",
        address: pick(row, ["LOC_SFPR_A", "ROAD_NM_ADDR", "ADDR", "ADDRESS", "주소", "소재지"]) || "주소 정보 없음",
        latitude: location.latitude,
        longitude: location.longitude,
        distanceMeters: 0,
        capacity: pick(row, ["QTY_CPTY", "CAPACITY", "수용인원"]),
        note: pick(row, ["GB_ACMD", "CD_GUBUN", "REMARK", "RMRK", "비고"]),
      }];
    });
  } finally {
    timeout.clear();
  }
}

export function sortNearbyShelters(
  shelters: Shelter[],
  currentLocation: { latitude: number; longitude: number },
  limit = 12
) {
  return shelters
    .map(shelter => ({
      ...shelter,
      distanceMeters: Math.round(haversineMeters(currentLocation, shelter)),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
}

async function loadShelters(riskType: RiskType) {
  if (shelterCache && shelterCache.key === riskType && Date.now() < shelterCache.expiresAt) {
    return shelterCache.shelters;
  }
  const shelters = riskType === "heatwave" ? await heatwaveShelters() : riskType === "rain" ? await floodShelters() : await civilShelters();
  shelterCache = { key: riskType, shelters, expiresAt: Date.now() + 6 * 60 * 60_000 };
  return shelters;
}

export async function getNearbyShelters(latitude: number, longitude: number, riskType: RiskType) {
  ensureSeoulCoordinate(latitude, longitude);
  if (!process.env.SEOUL_OPEN_API_KEY && riskType !== "rain") {
    throw new Error("서울 열린데이터광장 API 키를 설정하면 대피소를 표시합니다.");
  }
  const shelters = await loadShelters(riskType);
  return sortNearbyShelters(shelters, { latitude, longitude });
}

export async function getWalkingRoute(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number }
): Promise<WalkingRoute> {
  ensureSeoulCoordinate(origin.latitude, origin.longitude);
  ensureSeoulCoordinate(destination.latitude, destination.longitude);
  const key = requiredEnv("OPENROUTE_SERVICE_KEY");
  const timeout = withTimeout();
  try {
    const response = await fetch("https://api.openrouteservice.org/v2/directions/foot-walking/geojson", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: key },
      body: JSON.stringify({ coordinates: [[origin.longitude, origin.latitude], [destination.longitude, destination.latitude]] }),
      signal: timeout.signal,
    });
    if (!response.ok) throw new Error(`도보 경로 응답 오류 (${response.status})`);
    const payload = (await response.json()) as {
      features?: Array<{ geometry?: { coordinates?: Array<[number, number]> }; properties?: { summary?: { distance?: number; duration?: number } } }>;
    };
    const feature = payload.features?.[0];
    const coordinates = feature?.geometry?.coordinates;
    const summary = feature?.properties?.summary;
    if (!coordinates?.length || !summary) throw new Error("도보 경로 형식이 올바르지 않습니다.");
    return {
      distanceMeters: Math.round(summary.distance ?? 0),
      durationSeconds: Math.round(summary.duration ?? 0),
      coordinates: coordinates.map(([longitude, latitude]) => [latitude, longitude]),
    };
  } finally {
    timeout.clear();
  }
}

export function clearSafetyCachesForTests() {
  shelterCache = null;
  latestSnapshot = null;
  snapshotExpiresAt = 0;
}
