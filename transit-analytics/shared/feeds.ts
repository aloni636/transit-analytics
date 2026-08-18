
type UrlParamAuth = {
    kind: "urlParam";
    urlKey: string;
    credentialKey: string;
};

type BearerAuth = {
    kind: "bearer";
    credentialKey: string;
}

type GTFSAuthMethod = UrlParamAuth | undefined;
export type GTFSFeed = {
    static: {
        feedUrl: string;
        authMethod: GTFSAuthMethod;
        objectPrefix: string;
    };
    realtime: {
        feedUrl: string;
        authMethod: GTFSAuthMethod
    }
}

export const feeds = {
  /**
   * **Description**: Detailed Swedish data, but not every operator \
   * **Authentication**: Trafiklab query key \
   * **Update Frequency**: Daily, typically 05:00–06:00
   */
  GTFS_SWEDEN_3: {
    credentialKey: "GTFS_SWEDEN_3_STATIC_DATA",
    objectPrefix: "raw/sweden/gtfs-static/gtfs-sweden-3",
    createRequest: (credential: string) =>
      createTrafiklabRequest(
        "https://opendata.samtrafiken.se/gtfs-sweden/sweden.zip",
        credential,
      ),
  },

  /**
   * **Description**: All Swedish public transport with less detail \
   * **Authentication**: Trafiklab query key \
   * **Update Frequency**: Updated when data changes, at most daily
   */
  GTFS_SVERIGE_2: {
    credentialKey: "GTFS_SVERIGE_2",
    objectPrefix: "raw/sweden/gtfs-static/gtfs-sverige-2",
    createRequest: (credential: string) =>
      createTrafiklabRequest(
        "https://api.resrobot.se/gtfs/sweden.zip",
        credential,
      ),
  },

  /**
   * **Description**: Current Swiss timetable year \
   * **Authentication**: None for the static catalog download \
   * **Update Frequency**: Normally Monday and Thursday; the timetable-year permalink changes annually
   */
  GTFS_SWITZERLAND: {
    objectPrefix: "raw/switzerland/gtfs-static/gtfs-switzerland",
    createRequest: () =>
      new Request(
        "https://data.opentransportdata.swiss/en/dataset/timetable-2026-gtfs2020/permalink",
      ),
  },

  /**
   * **Description**: Nationwide full German feed \
   * **Authentication**: None \
   * **Update Frequency**: The free-feed pages disagree between a seven-day horizon and 30-day validity; use feed metadata
   */
  GTFS_GERMANY: {
    objectPrefix: "raw/germany/gtfs-static/gtfs-germany",
    createRequest: () =>
      new Request("https://download.gtfs.de/germany/free/latest.zip"),
  },
} as const satisfies Record<string, GTFSFeed>;
