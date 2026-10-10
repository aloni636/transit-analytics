export const realtimeAcceptEncoding = "br, gzip, deflate";

type UrlParamAuth = {
  readonly kind: "urlParam";
  readonly urlKey: string;
  readonly credentialKey: string;
  readonly secretArnEnvironmentVariable:
    | "TRAFIKLAB_SECRET_ARN"
    | "OPENTRANSPORTDATA_SECRET_ARN";
};

type BearerAuth = {
  readonly kind: "bearer";
  readonly credentialKey: string;
  readonly secretArnEnvironmentVariable:
    | "TRAFIKLAB_SECRET_ARN"
    | "OPENTRANSPORTDATA_SECRET_ARN";
};

export type GTFSAuthMethod = UrlParamAuth | BearerAuth | undefined;

type FeedSource = {
  readonly feedUrl: string;
  readonly authMethod: GTFSAuthMethod;
  readonly acceptEncoding?: string;
};

export type StaticFeedDefinition = FeedSource & {
  readonly objectPrefix: string;
};

export type RealtimeFeedDefinition = FeedSource & {
  readonly staticFeedKey: StaticFeedKey;
  readonly kind: "tripUpdates" | "serviceAlerts" | "mixed";
  readonly objectPrefix: string;
  readonly minimumPollIntervalSeconds: number;
};

export const staticFeeds = {
  /**
   * **Description**: Detailed Swedish data, but not every operator \
   * **Authentication**: Trafiklab query key \
   * **Update Frequency**: Daily, typically 05:00–06:00
   */
  GTFS_SWEDEN_3: {
    feedUrl: "https://opendata.samtrafiken.se/gtfs-sweden/sweden.zip",
    authMethod: {
      kind: "urlParam",
      urlKey: "key",
      credentialKey: "GTFS_SWEDEN_3_STATIC_DATA",
      secretArnEnvironmentVariable: "TRAFIKLAB_SECRET_ARN",
    },
    objectPrefix: "raw/sweden/gtfs-static/gtfs-sweden-3",
  },

  /**
   * **Description**: All Swedish public transport with less detail \
   * **Authentication**: Trafiklab query key \
   * **Update Frequency**: Updated when data changes, at most daily
   */
  GTFS_SVERIGE_2: {
    feedUrl: "https://api.resrobot.se/gtfs/sweden.zip",
    authMethod: {
      kind: "urlParam",
      urlKey: "key",
      credentialKey: "GTFS_SVERIGE_2",
      secretArnEnvironmentVariable: "TRAFIKLAB_SECRET_ARN",
    },
    objectPrefix: "raw/sweden/gtfs-static/gtfs-sverige-2",
  },

  /**
   * **Description**: Current Swiss timetable year \
   * **Authentication**: None for the static catalog download \
   * **Update Frequency**: Normally Monday and Thursday; the timetable-year permalink changes annually
   */
  GTFS_SWITZERLAND: {
    feedUrl:
      "https://data.opentransportdata.swiss/en/dataset/timetable-2026-gtfs2020/permalink",
    authMethod: undefined,
    objectPrefix: "raw/switzerland/gtfs-static/gtfs-switzerland",
  },

  /**
   * **Description**: Nationwide full German feed \
   * **Authentication**: None \
   * **Update Frequency**: The free-feed pages disagree between a seven-day horizon and 30-day validity; use feed metadata
   */
  GTFS_GERMANY: {
    feedUrl: "https://download.gtfs.de/germany/free/latest.zip",
    authMethod: undefined,
    objectPrefix: "raw/germany/gtfs-static/gtfs-germany",
  },
} as const satisfies Record<string, StaticFeedDefinition>;

export type StaticFeedKey = keyof typeof staticFeeds;

const swedishRealtimeOperators = {
  DT: "dt",
  JLT: "jlt",
  KRONO: "krono",
  OREBRO: "orebro",
  SKANE: "skane",
  SL: "sl",
  UL: "ul",
  VASTMANLAND: "vastmanland",
  VARM: "varm",
  XT: "xt",
  OTRAF: "otraf",
} as const;

const trafiklabTripUpdatesAuth = {
  kind: "urlParam",
  urlKey: "key",
  credentialKey: "GTFS_SWEDEN_3_REALTIME_DATA",
  secretArnEnvironmentVariable: "TRAFIKLAB_SECRET_ARN",
} as const;

const trafiklabServiceAlertsAuth = {
  kind: "urlParam",
  urlKey: "key",
  credentialKey: "GTFS_SWEDEN_3_SERVICE_ALERTS_DATA",
  secretArnEnvironmentVariable: "TRAFIKLAB_SECRET_ARN",
} as const;

type SwedishRealtimeOperator = keyof typeof swedishRealtimeOperators;

const swedishTripUpdatesFeeds = Object.fromEntries(
  Object.entries(swedishRealtimeOperators).map(([operatorKey, operator]) => [
    `GTFS_SWEDEN_3_TRIP_UPDATES_${operatorKey}`,
    {
      feedUrl: `https://opendata.samtrafiken.se/gtfs-rt-sweden/${operator}/TripUpdatesSweden.pb`,
      authMethod: trafiklabTripUpdatesAuth,
      acceptEncoding: realtimeAcceptEncoding,
      staticFeedKey: "GTFS_SWEDEN_3",
      kind: "tripUpdates",
      objectPrefix: `raw/sweden/gtfs-realtime/${operator}/trip-updates`,
      minimumPollIntervalSeconds: 15,
    },
  ]),
) as Readonly<
  Record<
    `GTFS_SWEDEN_3_TRIP_UPDATES_${SwedishRealtimeOperator}`,
    RealtimeFeedDefinition
  >
>;

const swedishServiceAlertsFeeds = Object.fromEntries(
  Object.entries(swedishRealtimeOperators).map(([operatorKey, operator]) => [
    `GTFS_SWEDEN_3_SERVICE_ALERTS_${operatorKey}`,
    {
      feedUrl: `https://opendata.samtrafiken.se/gtfs-rt-sweden/${operator}/ServiceAlertsSweden.pb`,
      authMethod: trafiklabServiceAlertsAuth,
      acceptEncoding: realtimeAcceptEncoding,
      staticFeedKey: "GTFS_SWEDEN_3",
      kind: "serviceAlerts",
      objectPrefix: `raw/sweden/gtfs-realtime/${operator}/service-alerts`,
      minimumPollIntervalSeconds: 15,
    },
  ]),
) as Readonly<
  Record<
    `GTFS_SWEDEN_3_SERVICE_ALERTS_${SwedishRealtimeOperator}`,
    RealtimeFeedDefinition
  >
>;

// Swiss GTFS-RT is cached for 30 seconds; 31 seconds avoids the boundary. https://opentransportdata.swiss/en/cookbook/realtime-prediction-cookbook/gtfs-rt/
const swissRealtimeMinimumPollIntervalSeconds = 31;

export const realtimeFeeds = {
  ...swedishTripUpdatesFeeds,
  ...swedishServiceAlertsFeeds,
  GTFS_SWITZERLAND_TRIP_UPDATES: {
    feedUrl: "https://api.opentransportdata.swiss/la/gtfs-rt",
    authMethod: {
      kind: "bearer",
      credentialKey: "GTFS_SWITZERLAND_REALTIME_DATA",
      secretArnEnvironmentVariable: "OPENTRANSPORTDATA_SECRET_ARN",
    },
    acceptEncoding: realtimeAcceptEncoding,
    staticFeedKey: "GTFS_SWITZERLAND",
    kind: "tripUpdates",
    objectPrefix: "raw/switzerland/gtfs-realtime/trip-updates",
    minimumPollIntervalSeconds: swissRealtimeMinimumPollIntervalSeconds,
  },
  GTFS_SWITZERLAND_SERVICE_ALERTS: {
    feedUrl: "https://api.opentransportdata.swiss/la/gtfs-sa",
    authMethod: {
      kind: "bearer",
      credentialKey: "GTFS_SWITZERLAND_REALTIME_DATA",
      secretArnEnvironmentVariable: "OPENTRANSPORTDATA_SECRET_ARN",
    },
    acceptEncoding: realtimeAcceptEncoding,
    staticFeedKey: "GTFS_SWITZERLAND",
    kind: "serviceAlerts",
    objectPrefix: "raw/switzerland/gtfs-realtime/service-alerts",
    minimumPollIntervalSeconds: swissRealtimeMinimumPollIntervalSeconds,
  },
  GTFS_GERMANY_REALTIME: {
    feedUrl: "https://realtime.gtfs.de/realtime-free.pb",
    authMethod: undefined,
    acceptEncoding: realtimeAcceptEncoding,
    staticFeedKey: "GTFS_GERMANY",
    kind: "mixed",
    objectPrefix: "raw/germany/gtfs-realtime/mixed",
    minimumPollIntervalSeconds: 10,
  },
} as const satisfies Record<string, RealtimeFeedDefinition>;

export type RealtimeFeedKey = keyof typeof realtimeFeeds;
export type FeedKey = StaticFeedKey | RealtimeFeedKey;

type CredentialKeyFor<Feed> = Feed extends {
  readonly authMethod: { readonly credentialKey: infer Key extends string };
}
  ? Key
  : never;

export type CredentialKey =
  | CredentialKeyFor<(typeof staticFeeds)[StaticFeedKey]>
  | CredentialKeyFor<(typeof realtimeFeeds)[RealtimeFeedKey]>;

export type FetcherEvent = {
  feedKey: FeedKey;
  scheduledTime: string;
};

export type StaticFetcherEvent = FetcherEvent;

export function createFeedRequest(
  feed: FeedSource,
  userAgent: string,
  credential?: string,
): Request {
  if (!userAgent.trim()) {
    throw new Error("User-Agent must not be empty.");
  }
  const url = new URL(feed.feedUrl);
  const headers = new Headers({ "User-Agent": userAgent });

  if (feed.acceptEncoding) {
    headers.set("Accept-Encoding", feed.acceptEncoding);
  }

  if (feed.authMethod) {
    if (!credential) {
      throw new Error(
        `Missing credential: ${feed.authMethod.credentialKey}`,
      );
    }
    if (feed.authMethod.kind === "urlParam") {
      url.searchParams.set(feed.authMethod.urlKey, credential);
    } else {
      headers.set("Authorization", `Bearer ${credential}`);
    }
  }

  return new Request(url, { headers });
}

export function assertFetcherEvent(
  event: unknown,
): asserts event is FetcherEvent {
  if (
    !event ||
    typeof event !== "object" ||
    !("feedKey" in event) ||
    typeof event.feedKey !== "string" ||
    (!Object.hasOwn(staticFeeds, event.feedKey) &&
      !Object.hasOwn(realtimeFeeds, event.feedKey))
  ) {
    throw new Error(
      `Invalid fetcher event. Expected feedKey: ${[
        ...Object.keys(staticFeeds),
        ...Object.keys(realtimeFeeds),
      ].join(", ")}`,
    );
  }
  if (
    !("scheduledTime" in event) ||
    typeof event.scheduledTime !== "string" ||
    !Number.isFinite(Date.parse(event.scheduledTime))
  ) {
    throw new Error(
      "Invalid fetcher event. Expected scheduledTime to be an ISO 8601 timestamp.",
    );
  }
}

export function validateRealtimeInterval(
  feedKey: FeedKey,
  intervalSeconds: number,
): void {
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 1) {
    throw new Error("Realtime intervalSeconds must be a positive integer.");
  }
  if (!Object.hasOwn(realtimeFeeds, feedKey)) {
    throw new Error(`Realtime interval is not valid for static feed: ${feedKey}`);
  }
  const feed = realtimeFeeds[feedKey as RealtimeFeedKey];
  if (intervalSeconds < feed.minimumPollIntervalSeconds) {
    throw new Error(
      `Realtime intervalSeconds for ${feedKey} must be at least ${feed.minimumPollIntervalSeconds}.`,
    );
  }
}

export const assertStaticFetcherEvent = assertFetcherEvent;
