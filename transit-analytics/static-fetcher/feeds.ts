function createTrafiklabRequest(url: string, credential: string): Request {
  const requestUrl = new URL(url);
  requestUrl.searchParams.set("key", credential);
  return new Request(requestUrl);
}

type FeedBase = {
  readonly objectPrefix: string;
};

export type Feed =
  | (FeedBase & {
    readonly credentialKey: string;
    readonly createRequest: (credential: string) => Request;
  })
  | (FeedBase & {
    readonly credentialKey?: never;
    readonly createRequest: () => Request;
  });

export const feeds = {
  GTFS_SWEDEN_3: {
    credentialKey: "GTFS_SWEDEN_3_STATIC_DATA",
    objectPrefix: "raw/sweden/gtfs-static/gtfs-sweden-3",
    createRequest: (credential: string) =>
      createTrafiklabRequest(
        "https://opendata.samtrafiken.se/gtfs-sweden/sweden.zip",
        credential,
      ),
  },
  GTFS_SVERIGE_2: {
    credentialKey: "GTFS_SVERIGE_2",
    objectPrefix: "raw/sweden/gtfs-static/gtfs-sverige-2",
    createRequest: (credential: string) =>
      createTrafiklabRequest(
        "https://api.resrobot.se/gtfs/sweden.zip",
        credential,
      ),
  },
  // Published on Mondays and Thursdays; update this timetable-year permalink annually.
  GTFS_SWITZERLAND: {
    objectPrefix: "raw/switzerland/gtfs-static/gtfs-switzerland",
    createRequest: () =>
      new Request(
        "https://data.opentransportdata.swiss/en/dataset/timetable-2026-gtfs2020/permalink",
      ),
  },
  // latest.zip is periodically replaced; provider pages disagree on its timetable horizon.
  GTFS_GERMANY: {
    objectPrefix: "raw/germany/gtfs-static/gtfs-germany",
    createRequest: () =>
      new Request("https://download.gtfs.de/germany/free/latest.zip"),
  },
} as const satisfies Record<string, Feed>;

export type FeedKey = keyof typeof feeds;
export type CredentialKey = Extract<
  (typeof feeds)[FeedKey],
  { readonly credentialKey: string }
>["credentialKey"];
export type StaticFetcherEvent = { key: FeedKey };

export function assertStaticFetcherEvent(
  event: unknown,
): asserts event is StaticFetcherEvent {
  if (
    !event ||
    typeof event !== "object" ||
    !("key" in event) ||
    typeof event.key !== "string" ||
    !Object.hasOwn(feeds, event.key)
  ) {
    throw new Error(
      `Invalid static fetcher event. Expected key: ${Object.keys(feeds).join(", ")}`,
    );
  }
}
