import { useEffect, useMemo, useRef, useState } from "react";
import {
  BellRing,
  ChevronRight,
  CloudRain,
  Compass,
  LocateFixed,
  MapPinned,
  Navigation,
  RefreshCw,
  ShieldAlert,
  SunMedium,
  ThermometerSun,
  TriangleAlert,
  Umbrella,
  Waves,
} from "lucide-react";
import { SafetyMap } from "@/components/SafetyMap";
import { trpc } from "@/lib/trpc";
import type { RiskType, Shelter } from "../../../server/safety";

type LocationState = {
  latitude: number;
  longitude: number;
  precision?: number;
  source: "device" | "default";
};

const SEOUL_CITY_HALL: LocationState = {
  latitude: 37.5665,
  longitude: 126.978,
  source: "default",
};

const RISK_TABS: Array<{ value: RiskType; label: string; icon: typeof SunMedium; detail: string }> = [
  { value: "heatwave", label: "폭염", icon: SunMedium, detail: "무더위쉼터" },
  { value: "rain", label: "호우", icon: CloudRain, detail: "수해대피소" },
  { value: "civil", label: "민방위", icon: ShieldAlert, detail: "민방위대피시설" },
];

function formatDistance(meters: number) {
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

function formatDuration(seconds: number) {
  return `${Math.max(1, Math.round(seconds / 60))}분`;
}

function sourceLabel(sourceCode: Shelter["sourceCode"]) {
  if (sourceCode === "OA-21065") return "무더위쉼터 · OA-21065";
  if (sourceCode === "OA-21181") return "수해대피소 · OA-21181";
  return "민방위대피시설 · LOCALDATA_114602";
}

function AlertIcon({ type }: { type: "heatwave" | "rain" }) {
  return type === "heatwave" ? <ThermometerSun size={19} /> : <Umbrella size={19} />;
}

export default function Home() {
  const [location, setLocation] = useState<LocationState>(SEOUL_CITY_HALL);
  const [locationMessage, setLocationMessage] = useState("현재 위치를 불러오면 주변 대피소를 안내합니다.");
  const [selectedRisk, setSelectedRisk] = useState<RiskType>("heatwave");
  const [selectedShelter, setSelectedShelter] = useState<Shelter | null>(null);
  const [notificationState, setNotificationState] = useState<NotificationPermission | "unsupported">(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );
  const notifiedAlerts = useRef(new Set<string>());

  const locationInput = useMemo(
    () => ({ latitude: location.latitude, longitude: location.longitude }),
    [location.latitude, location.longitude]
  );
  const snapshotQuery = trpc.safety.snapshot.useQuery(locationInput, {
    retry: false,
    refetchInterval: 180_000,
    staleTime: 120_000,
  });
  const effectiveRisk = selectedRisk || snapshotQuery.data?.activeRisk || "heatwave";
  const shelterInput = useMemo(
    () => ({ ...locationInput, riskType: effectiveRisk }),
    [effectiveRisk, locationInput]
  );
  const sheltersQuery = trpc.safety.shelters.useQuery(shelterInput, {
    retry: false,
    staleTime: 5 * 60_000,
  });
  const routeInput = useMemo(
    () =>
      selectedShelter
        ? { origin: locationInput, destination: { latitude: selectedShelter.latitude, longitude: selectedShelter.longitude } }
        : undefined,
    [locationInput, selectedShelter]
  );
  const routeQuery = trpc.safety.route.useQuery(routeInput!, {
    enabled: Boolean(routeInput),
    retry: false,
    staleTime: 5 * 60_000,
  });

  const snapshot = snapshotQuery.data;
  const shelters = sheltersQuery.data ?? [];
  const alerts = snapshot?.alerts ?? [];

  useEffect(() => {
    if (snapshot?.activeRisk && selectedRisk === "heatwave" && alerts.length > 0) {
      setSelectedRisk(snapshot.activeRisk);
    }
  }, [alerts.length, selectedRisk, snapshot?.activeRisk]);

  useEffect(() => {
    setSelectedShelter(null);
  }, [effectiveRisk]);

  useEffect(() => {
    if (notificationState !== "granted") return;
    alerts.forEach(alert => {
      if (notifiedAlerts.current.has(alert.id)) return;
      notifiedAlerts.current.add(alert.id);
      new Notification(alert.title, { body: alert.summary, tag: alert.id });
    });
  }, [alerts, notificationState]);

  function requestLocation() {
    if (!navigator.geolocation) {
      setLocationMessage("이 브라우저는 위치 서비스를 지원하지 않습니다. 서울시청 기준으로 안내합니다.");
      return;
    }
    setLocationMessage("기기 위치를 확인하고 있습니다.");
    navigator.geolocation.getCurrentPosition(
      position => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          precision: Math.round(position.coords.accuracy),
          source: "device",
        });
        setLocationMessage(`현재 위치를 반영했습니다. 오차 범위 약 ${Math.round(position.coords.accuracy)}m`);
      },
      error => {
        const message = error.code === error.PERMISSION_DENIED
          ? "위치 권한이 필요합니다. 권한을 허용하면 주변 대피소를 안내합니다."
          : "현재 위치를 불러오지 못했습니다. 서울시청 기준으로 안내합니다.";
        setLocationMessage(message);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  }

  async function requestNotifications() {
    if (typeof Notification === "undefined") {
      setNotificationState("unsupported");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationState(permission);
  }

  const selectedTab = RISK_TABS.find(tab => tab.value === effectiveRisk) ?? RISK_TABS[0];

  return (
    <div className="safety-app-shell">
      <header className="site-header">
        <a href="#top" className="brand" aria-label="서울 안전 길잡이 첫 화면">
          <span className="brand-mark"><ShieldAlert size={20} /></span>
          <span>서울 안전 길잡이</span>
        </a>
        <div className="header-status">
          <span className="live-indicator"><i />실시간 안전 정보</span>
          <button className="quiet-action" onClick={requestNotifications} type="button">
            <BellRing size={16} />
            {notificationState === "granted" ? "알림 켜짐" : "특보 알림"}
          </button>
        </div>
      </header>

      <main id="top" className="page-grid">
        <section className="hero-copy" aria-labelledby="hero-title">
          <p className="eyebrow">SEOUL · SAFETY NAVIGATOR</p>
          <h1 id="hero-title">위험을 먼저 읽고,<br /><em>안전한 곳</em>으로 안내합니다.</h1>
          <p className="hero-description">
            기상청 특보와 현재 날씨를 확인해 상황에 맞는 서울시 공식 대피시설을 안내합니다.
            위급한 상황에서는 앱보다 <strong>119·112와 현장 통제</strong>를 우선해 주세요.
          </p>
          <div className="location-callout">
            <div className="location-icon"><MapPinned size={20} /></div>
            <div>
              <p className="micro-label">위치 상태</p>
              <p>{locationMessage}</p>
            </div>
            <button className="location-button" onClick={requestLocation} type="button">
              <LocateFixed size={17} /> 현재 위치
            </button>
          </div>
        </section>

        <section className="weather-panel" aria-label="기상청 기반 현재 날씨">
          <div className="panel-header">
            <div>
              <p className="micro-label">기상청 초단기실황</p>
              <h2>현재 기상</h2>
            </div>
            <button className="icon-button" type="button" aria-label="기상 정보 새로고침" onClick={() => void snapshotQuery.refetch()}>
              <RefreshCw size={17} className={snapshotQuery.isFetching ? "spin" : ""} />
            </button>
          </div>
          {snapshotQuery.isLoading ? (
            <div className="weather-loading">기상청 데이터를 확인하고 있습니다.</div>
          ) : snapshot?.weather ? (
            <div className="weather-grid">
              <div className="weather-primary">
                <span><ThermometerSun size={20} /></span>
                <strong>{snapshot.weather.temperatureC === null ? "—" : `${snapshot.weather.temperatureC.toFixed(1)}°`}</strong>
                <small>기온</small>
              </div>
              <div className="weather-stat"><span>강수량</span><strong>{snapshot.weather.rainfallMm === null ? "—" : `${snapshot.weather.rainfallMm.toFixed(1)}mm`}</strong></div>
              <div className="weather-stat"><span>습도</span><strong>{snapshot.weather.humidityPct === null ? "—" : `${snapshot.weather.humidityPct}%`}</strong></div>
            </div>
          ) : (
            <div className="weather-loading">{snapshot?.sourceMessage || snapshotQuery.error?.message || "기상 정보 준비 중"}</div>
          )}
          <p className="weather-time">{snapshot?.generatedAt ? `갱신 ${new Date(snapshot.generatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}` : "API 키 설정 후 자동 갱신"}</p>
        </section>

        <section className="warning-area" aria-live="polite">
          {alerts.length ? alerts.map(alert => (
            <article className={`warning-card ${alert.type} ${alert.severity}`} key={alert.id}>
              <div className="warning-icon"><AlertIcon type={alert.type} /></div>
              <div>
                <p className="micro-label">{alert.official ? "기상청 공식 특보" : "관측 기반 안전 안내"}</p>
                <h2>{alert.title}</h2>
                <p>{alert.summary}</p>
              </div>
              <TriangleAlert size={21} />
            </article>
          )) : (
            <article className="clear-card">
              <span className="clear-mark"><ShieldAlert size={20} /></span>
              <div><p className="micro-label">위험 신호</p><h2>현재 표시할 특보가 없습니다</h2></div>
              <span>계속 감시 중</span>
            </article>
          )}
        </section>

        <section className="navigator-section" aria-labelledby="navigator-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">EVACUATION GUIDE</p>
              <h2 id="navigator-title">상황에 맞는 대피소</h2>
            </div>
            <p>현재 위치 기준 직선거리 순으로 표시합니다.</p>
          </div>
          <div className="risk-tabs" role="tablist" aria-label="재난 유형 선택">
            {RISK_TABS.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={effectiveRisk === tab.value}
                  className={effectiveRisk === tab.value ? "active" : ""}
                  onClick={() => setSelectedRisk(tab.value)}
                >
                  <Icon size={18} />
                  <span>{tab.label}</span>
                  <small>{tab.detail}</small>
                </button>
              );
            })}
          </div>

          <div className="navigator-layout">
            <div className="shelter-list-panel">
              <div className="shelter-panel-header">
                <div>
                  <p className="micro-label">{selectedTab.detail}</p>
                  <h3>주변 후보 {shelters.length ? `${shelters.length}곳` : ""}</h3>
                </div>
                <Compass size={19} />
              </div>
              {sheltersQuery.isLoading ? <div className="empty-state">공식 시설 데이터를 불러오고 있습니다.</div> : null}
              {sheltersQuery.error ? <div className="empty-state error">{sheltersQuery.error.message}</div> : null}
              {!sheltersQuery.isLoading && !sheltersQuery.error && shelters.length === 0 ? (
                <div className="empty-state">표시할 시설이 없습니다. 위치와 데이터 연동 상태를 확인해 주세요.</div>
              ) : null}
              <div className="shelter-list">
                {shelters.map((shelter, index) => (
                  <button
                    type="button"
                    className={`shelter-item ${selectedShelter?.id === shelter.id ? "selected" : ""}`}
                    key={shelter.id}
                    onClick={() => setSelectedShelter(shelter)}
                  >
                    <span className="shelter-rank">{String(index + 1).padStart(2, "0")}</span>
                    <span className="shelter-detail">
                      <strong>{shelter.name}</strong>
                      <small>{shelter.address}</small>
                      <em>{sourceLabel(shelter.sourceCode)}</em>
                    </span>
                    <span className="shelter-distance">{formatDistance(shelter.distanceMeters)}<ChevronRight size={17} /></span>
                  </button>
                ))}
              </div>
            </div>
            <div className="map-panel">
              <SafetyMap location={location} shelters={shelters} selectedShelter={selectedShelter} route={routeQuery.data ?? null} />
              {selectedShelter ? (
                <div className="route-strip">
                  <div><p className="micro-label">선택한 대피소</p><strong>{selectedShelter.name}</strong></div>
                  {routeQuery.isLoading ? <span>도보 경로 계산 중</span> : null}
                  {routeQuery.error ? <span className="route-error">{routeQuery.error.message}</span> : null}
                  {routeQuery.data ? <span><Navigation size={15} />도보 {formatDistance(routeQuery.data.distanceMeters)} · 약 {formatDuration(routeQuery.data.durationSeconds)}</span> : null}
                </div>
              ) : <div className="route-strip quiet"><span>대피소를 선택하면 도보 경로와 예상 시간을 표시합니다.</span></div>}
            </div>
          </div>
        </section>

        <section className="safety-note">
          <Waves size={22} />
          <div><strong>호우 시 안전 수칙</strong><p>침수된 도로·지하차도·하천변에는 접근하지 마시고, 재난문자와 현장 통제에 따라 이동하세요.</p></div>
          <a href="https://safecity.seoul.go.kr" target="_blank" rel="noreferrer">서울안전누리 <ChevronRight size={15} /></a>
        </section>
      </main>

      <footer className="site-footer">
        <span>서울시 공식 대피시설 데이터와 기상청 정보 기반</span>
        <span>지도 © OpenStreetMap contributors</span>
      </footer>
    </div>
  );
}
