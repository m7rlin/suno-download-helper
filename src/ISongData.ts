import { TDownloadStatus } from "./TDownloadStatus";


export interface ISongData {
  title: string | null;
  clipId: string;
  style: string | null;
  thumbnail: string | null;
  model: string | null;
  duration: string | null;
  mp3Status: TDownloadStatus;
  wavStatus: TDownloadStatus;
  songUrl: string;
  liked: boolean;
}
