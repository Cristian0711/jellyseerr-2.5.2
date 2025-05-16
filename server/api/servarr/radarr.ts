import logger from '@server/logger';
import ServarrBase from './base';

export interface RadarrMovieOptions {
  title: string;
  qualityProfileId: number;
  minimumAvailability: string;
  tags: number[];
  profileId: number;
  year: number;
  rootFolderPath: string;
  tmdbId: number;
  monitored?: boolean;
  searchNow?: boolean;
}

export interface RadarrMovie {
  id: number;
  title: string;
  isAvailable: boolean;
  monitored: boolean;
  tmdbId: number;
  imdbId: string;
  titleSlug: string;
  folderName: string;
  path: string;
  profileId: number;
  qualityProfileId: number;
  added: string;
  hasFile: boolean;
  tags: number[];
  movieFile?: {
    id: number;
    movieId: number;
    relativePath?: string;
    path?: string;
    size: number;
    dateAdded: string;
    sceneName?: string;
    releaseGroup?: string;
    edition?: string;
    indexerFlags?: number;
    mediaInfo: {
      id: number;
      audioBitrate: number;
      audioChannels: number;
      audioCodec?: string;
      audioLanguages?: string;
      audioStreamCount: number;
      videoBitDepth: number;
      videoBitrate: number;
      videoCodec?: string;
      videoFps: number;
      videoDynamicRange?: string;
      videoDynamicRangeType?: string;
      resolution?: string;
      runTime?: string;
      scanType?: string;
      subtitles?: string;
    };
    originalFilePath?: string;
    qualityCutoffNotMet: boolean;
  };
}

interface Language {
  id: number;
  name: string;
}

interface QualityInfo {
  id: number;
  name: string;
  source: string;
  resolution: number;
  modifier: string;
}

interface RevisionInfo {
  version: number;
  real: number;
  isRepack: boolean;
}

interface Quality {
  quality: QualityInfo;
  revision: RevisionInfo;
}

interface QueueRecord {
  movieId: number;
  languages: Language[];
  quality: Quality;
  customFormats: any[];
  customFormatScore: number;
  size: number;
  title: string;
  estimatedCompletionTime: string;
  added: string;
  status: string;
  trackedDownloadStatus: string;
  trackedDownloadState: string;
  statusMessages: any[];
  downloadId: string;
  protocol: string;
  downloadClient: string;
  downloadClientHasPostImportCategory: boolean;
  indexer: string;
  sizeleft: number;
  timeleft: string;
  id: number;
}

interface QueueResponse {
  page: number;
  pageSize: number;
  sortKey: string;
  sortDirection: string;
  totalRecords: number;
  records: QueueRecord[];
}

class RadarrAPI extends ServarrBase<{ movieId: number }> {
  constructor({ url, apiKey }: { url: string; apiKey: string }) {
    super({ url, apiKey, cacheName: 'radarr', apiName: 'Radarr' });
  }

  public getMovies = async (): Promise<RadarrMovie[]> => {
    try {
      const data = await this.get<RadarrMovie[]>('/movie');

      return data;
    } catch (e) {
      throw new Error(`[Radarr] Failed to retrieve movies: ${e.message}`);
    }
  };

  public getMovie = async ({ id }: { id: number }): Promise<RadarrMovie> => {
    try {
      const data = await this.get<RadarrMovie>(`/movie/${id}`);

      return data;
    } catch (e) {
      throw new Error(`[Radarr] Failed to retrieve movie: ${e.message}`);
    }
  };

  public async getMovieByTmdbId(id: number): Promise<RadarrMovie> {
    try {
      const data = await this.get<RadarrMovie[]>('/movie/lookup', {
        term: `tmdb:${id}`,
      });

      if (!data[0]) {
        throw new Error('Movie not found');
      }

      return data[0];
    } catch (e) {
      logger.error('Error retrieving movie by TMDB ID', {
        label: 'Radarr API',
        errorMessage: e.message,
        tmdbId: id,
      });
      throw new Error('Movie not found');
    }
  }

  public addMovie = async (
    options: RadarrMovieOptions
  ): Promise<RadarrMovie> => {
    try {
      const movie = await this.getMovieByTmdbId(options.tmdbId);

      if (movie.hasFile) {
        logger.info(
          'Title already exists and is available. Skipping add and returning success',
          {
            label: 'Radarr',
            movie,
          }
        );
        return movie;
      }

      // movie exists in Radarr but is neither downloaded nor monitored
      if (movie.id && !movie.monitored) {
        const data = await this.put<RadarrMovie>(`/movie`, {
          ...movie,
          title: options.title,
          qualityProfileId: options.qualityProfileId,
          profileId: options.profileId,
          titleSlug: options.tmdbId.toString(),
          minimumAvailability: options.minimumAvailability,
          tmdbId: options.tmdbId,
          year: options.year,
          tags: Array.from(new Set([...movie.tags, ...options.tags])),
          rootFolderPath: options.rootFolderPath,
          monitored: options.monitored,
          addOptions: {
            searchForMovie: options.searchNow,
          },
        });

        if (data.monitored) {
          logger.info(
            'Found existing title in Radarr and set it to monitored.',
            {
              label: 'Radarr',
              movieId: data.id,
              movieTitle: data.title,
            }
          );
          logger.debug('Radarr update details', {
            label: 'Radarr',
            movie: data,
          });

          if (options.searchNow) {
            this.searchMovie(data.id);
          }

          return data;
        } else {
          logger.error('Failed to update existing movie in Radarr.', {
            label: 'Radarr',
            options,
          });
          throw new Error('Failed to update existing movie in Radarr');
        }
      }

      if (movie.id) {
        logger.info(
          'Movie is already monitored in Radarr. Skipping add and returning success',
          { label: 'Radarr' }
        );
        return movie;
      }

      const data = await this.post<RadarrMovie>(`/movie`, {
        title: options.title,
        qualityProfileId: options.qualityProfileId,
        profileId: options.profileId,
        titleSlug: options.tmdbId.toString(),
        minimumAvailability: options.minimumAvailability,
        tmdbId: options.tmdbId,
        year: options.year,
        rootFolderPath: options.rootFolderPath,
        monitored: options.monitored,
        tags: options.tags,
        addOptions: {
          searchForMovie: options.searchNow,
        },
      });

      if (data.id) {
        logger.info('Radarr accepted request', { label: 'Radarr' });
        logger.debug('Radarr add details', {
          label: 'Radarr',
          movie: data,
        });
      } else {
        logger.error('Failed to add movie to Radarr', {
          label: 'Radarr',
          options,
        });
        throw new Error('Failed to add movie to Radarr');
      }
      return data;
    } catch (e) {
      let errorData;
      try {
        errorData = await e.cause?.text();
        errorData = JSON.parse(errorData);
      } catch {
        /* empty */
      }
      logger.error(
        'Failed to add movie to Radarr. This might happen if the movie already exists, in which case you can safely ignore this error.',
        {
          label: 'Radarr',
          errorMessage: e.message,
          options,
          response: errorData,
        }
      );
      throw new Error('Failed to add movie to Radarr');
    }
  };

  public async searchMovie(movieId: number): Promise<void> {
    logger.info('Executing movie search command', {
      label: 'Radarr API',
      movieId,
    });

    try {
      await this.runCommand('MoviesSearch', { movieIds: [movieId] });
    } catch (e) {
      logger.error(
        'Something went wrong while executing Radarr movie search.',
        {
          label: 'Radarr API',
          errorMessage: e.message,
          movieId,
        }
      );
    }
  }
  public removeMovie = async (movieId: number): Promise<void> => {
    try {
      const { id, title } = await this.getMovieByTmdbId(movieId);

      // Step 1: Get queue
      const queueResponse = await this.get<QueueResponse>('/queue', {
        page: '1',
        pageSize: '1000',
        sortDirection: 'ascending',
        sortKey: 'timeleft',
        includeUnknownMovieItems: 'true',
      });
      // Step 2: Find the queue item matching the movieId
      const queueItem = queueResponse?.records?.find(
        (item: any) => item.movieId === id
      );

      if (queueItem) {
        const queueId = queueItem.id;

        // Step 3: Remove the item from queue
        await this.delete(`/queue/${queueId}`, {
          removeFromClient: 'true',
          blocklist: 'false',
          skipRedownload: 'false',
          changeCategory: 'false',
        });

        logger.info(`[Radarr] Removed movie from queue (ID ${queueId})`);
      } else {
        logger.info(`[Radarr] No matching queue item for movie ID ${id}`);
      }

      // Step 4: Remove the movie
      await this.delete(`/movie/${id}`, {
        deleteFiles: 'true',
        addImportExclusion: 'false',
      });

      logger.info(`[Radarr] Removed movie ${title}`);
    } catch (e: any) {
      throw new Error(`[Radarr] Failed to remove movie: ${e.message}`);
    }
  };

  public clearCache = ({
    tmdbId,
    externalId,
  }: {
    tmdbId?: number | null;
    externalId?: number | null;
  }) => {
    if (tmdbId) {
      this.removeCache('/movie/lookup', {
        term: `tmdb:${tmdbId}`,
        headers: this.defaultHeaders,
      });
    }
    if (externalId) {
      this.removeCache(`/movie/${externalId}`, {
        headers: this.defaultHeaders,
      });
    }
  };
}

export default RadarrAPI;
