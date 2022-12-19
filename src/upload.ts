import { AxiosResponse } from "axios";
//import { DetailedError, HttpRequest, Upload } from "@skynetlabs/tus-js-client";

import { DetailedError, HttpRequest, Upload } from "tus-js-client";

import { createHash } from 'blake3';

import blake3 from 'blake3/browser';

import { getFileMimeType } from "./utils/file";
import { BaseCustomOptions, DEFAULT_BASE_OPTIONS } from "./utils/options";
import { formatSkylink } from "./skylink/format";
import { S5Client } from "./client";
import { JsonData } from "./utils/types";
import {
  throwValidationError,
} from "./utils/validation";
import { buildRequestHeaders, buildRequestUrl } from "./request";

export const mhashBlake3Default = 0x1f;
export const cidTypeRaw = 0x26;

/**
 * The tus chunk size is (4MiB - encryptionOverhead) * dataPieces, set in skyd.
 */
export const TUS_CHUNK_SIZE = (1 << 22) * 10;

/**
 * Indicates what the default chunk size multiplier is.
 */
const DEFAULT_TUS_CHUNK_SIZE_MULTIPLIER = 3;

/**
 * Indicates how many parts should be uploaded in parallel, by default.
 */
const DEFAULT_TUS_PARALLEL_UPLOADS = 2;

/**
 * The retry delays, in ms. Data is stored in skyd for up to 20 minutes, so the
 * total delays should not exceed that length of time.
 */
const DEFAULT_TUS_RETRY_DELAYS = [0, 5_000, 15_000, 60_000, 300_000, 600_000];

/**
 * Indicates the default stagger percent between chunk uploads.
 */
const DEFAULT_TUS_STAGGER_PERCENT = 50;

/**
 * The portal file field name.
 */
const PORTAL_FILE_FIELD_NAME = "file";
/**
 * The portal directory file field name.
 */
const PORTAL_DIRECTORY_FILE_FIELD_NAME = "files[]";

/**
 * Custom upload options.
 *
 * @property [endpointUpload] - The relative URL path of the portal endpoint to contact.
 * @property [endpointLargeUpload] - The relative URL path of the portal endpoint to contact for large uploads.
 * @property [chunkSizeMultiplier=1] - The multiplier for the chunk size. Increase this to upload larger chunks. Note that all valid chunks must be multiplies of the minimum chunk size, so this is a multiplier and not the actual chunk size.
 * @property [customFilename] - The custom filename to use when uploading files.
 * @property [largeFileSize=41943040] - The size at which files are considered "large" and will be uploaded using the tus resumable upload protocol. This is the size of one chunk by default (40 mib). Note that this does not affect the actual size of chunks used by the protocol.
 * @property [errorPages] - Defines a mapping of error codes and subfiles which are to be served in case we are serving the respective error code. All subfiles referred like this must be defined with absolute paths and must exist.
 * @property [numParallelUploads=2] - Used to override the default number of parallel uploads. Disable parallel uploads by setting to 1. Note that each parallel upload must be chunk-aligned so the number of parallel uploads may be limited if some parts would end up empty.
 * @property [staggerPercent] - A percentage from 0-100. `numParallelUploads` must be more than 1. When set, each chunk is staggered, one after another, instead of all uploads running simultaneously. The stagger percentage is how much of each chunk upload should be finished before the next chunk upload is initiated. Pass `null` to disable staggering.
 * @property [retryDelays=[0, 5_000, 15_000, 60_000, 300_000, 600_000]] - An array or undefined, indicating how many milliseconds should pass before the next attempt to uploading will be started after the transfer has been interrupted. The array's length indicates the maximum number of attempts.
 * @property [tryFiles] - Allows us to set a list of potential subfiles to return in case the requested one does not exist or is a directory. Those subfiles might be listed with relative or absolute paths. If the path is absolute the file must exist.
 */
export type CustomUploadOptions = BaseCustomOptions & {
  endpointUpload?: string;
  endpointDirectoryUpload: string;
  endpointLargeUpload?: string;

  customFilename?: string;
  errorPages?: JsonData;
  tryFiles?: string[];

  // Large files.
  chunkSizeMultiplier?: number;
  largeFileSize?: number;
  numParallelUploads?: number;
  staggerPercent?: number | null;
  retryDelays?: number[];
};

/**
 * The response to an upload request.
 *
 * @property skylink - 46-character skylink.
 */
export type UploadRequestResponse = {
  skylink: string;
};

export const DEFAULT_UPLOAD_OPTIONS = {
  ...DEFAULT_BASE_OPTIONS,

  endpointUpload: "/s5/upload",
  endpointDirectoryUpload: "/s5/upload/directory",
  endpointLargeUpload: "/s5/upload/tus",

  customFilename: "",
  errorPages: undefined,
  tryFiles: undefined,

  // Large files.
  chunkSizeMultiplier: DEFAULT_TUS_CHUNK_SIZE_MULTIPLIER,
  largeFileSize: TUS_CHUNK_SIZE,
  numParallelUploads: DEFAULT_TUS_PARALLEL_UPLOADS,
  staggerPercent: DEFAULT_TUS_STAGGER_PERCENT,
  retryDelays: DEFAULT_TUS_RETRY_DELAYS,
};

/**
 * Uploads a file to S5-net.
 *
 * @param this - S5Client
 * @param file - The file to upload.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @param [customOptions.endpointUpload="/s5/upload"] - The relative URL path of the portal endpoint to contact for small uploads.
 * @param [customOptions.endpointDirectoryUpload="/s5/upload/directory"] - The relative URL path of the portal endpoint to contact for Directory uploads.
 * @param [customOptions.endpointLargeUpload="/s5/upload/tus"] - The relative URL path of the portal endpoint to contact for large uploads.
 * @returns - The returned skylink.
 * @throws - Will throw if the request is successful but the upload response does not contain a complete response.
 */
export async function uploadFile(
  this: S5Client,
  file: File,
  customOptions?: CustomUploadOptions
): Promise<UploadRequestResponse> {
  // Validation is done in `uploadSmallFileRequest` or `uploadLargeFileRequest`.

  const opts = { ...DEFAULT_UPLOAD_OPTIONS, ...this.customOptions, ...customOptions };

  if (file.size < opts.largeFileSize * opts.chunkSizeMultiplier) {
    return this.uploadSmallFile(file, opts);
  } else {
    return this.uploadLargeFile(file, opts);
  }
}

/**
 * Uploads a small file to S5-net.
 *
 * @param this - S5Client
 * @param file - The file to upload.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @param [customOptions.endpointUpload="/s5/upload"] - The relative URL path of the portal endpoint to contact.
 * @returns - The returned skylink.
 * @throws - Will throw if the request is successful but the upload response does not contain a complete response.
 */
export async function uploadSmallFile(
  this: S5Client,
  file: File,
  customOptions: CustomUploadOptions
): Promise<UploadRequestResponse> {
  const response = await this.uploadSmallFileRequest(file, customOptions);

  // Sanity check.
//  validateUploadResponse(response);

//  const skylink = formatSkylink(response.data.skylink);
//  return { skylink };

  const responsedS5Cid = response.data.cid;

  return `${responsedS5Cid}`;
}

/**
 * Makes a request to upload a small file to S5-net.
 *
 * @param this - S5Client
 * @param file - The file to upload.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @param [customOptions.endpointPath="/s5/upload"] - The relative URL path of the portal endpoint to contact.
 * @returns - The upload response.
 */
export async function uploadSmallFileRequest(
  this: S5Client,
  file: File,
  customOptions?: CustomUploadOptions
): Promise<AxiosResponse> {
//  validateFile("file", file, "parameter");
//  validateOptionalObject("customOptions", customOptions, "parameter", DEFAULT_UPLOAD_OPTIONS);

  const opts = { ...DEFAULT_UPLOAD_OPTIONS, ...this.customOptions, ...customOptions };
  const formData = new FormData();

  file = ensureFileObjectConsistency(file);
  if (opts.customFilename) {
    formData.append(PORTAL_FILE_FIELD_NAME, file, opts.customFilename);
  } else {
    formData.append(PORTAL_FILE_FIELD_NAME, file);
  }

  const response = await this.executeRequest({
    ...opts,
    endpointPath: opts.endpointUpload,
    method: "post",
    data: formData,
  });

  return response;
}




/* istanbul ignore next */
/**
 * Uploads a large file to S5-net using tus.
 *
 * @param this - S5Client
 * @param file - The file to upload.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @param [customOptions.endpointLargeUpload="/s5/upload/tus"] - The relative URL path of the portal endpoint to contact.
 * @returns - The returned skylink.
 * @throws - Will throw if the request is successful but the upload response does not contain a complete response.
 */
export async function uploadLargeFile(
  this: S5Client,
  file: File,
  customOptions?: CustomUploadOptions
): Promise<UploadRequestResponse> {
  // Validation is done in `uploadLargeFileRequest`.

  const response = await this.uploadLargeFileRequest(file, customOptions);

  // Sanity check.
//  validateLargeUploadResponse(response);

  // Get the skylink.
  let skylink = response.headers["s5-skylink"];

  // Format the skylink.
  skylink = formatSkylink(skylink);

  return { skylink };
}

/* istanbul ignore next */
/**
 * Makes a request to upload a file to S5-net.
 *
 * @param this - S5Client
 * @param file - The file to upload.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @param [customOptions.endpointLargeUpload="/s5/upload/tus"] - The relative URL path of the portal endpoint to contact.
 * @returns - The upload response.
 */
export async function uploadLargeFileRequest(
  this: S5Client,
  file: File,
  customOptions?: CustomUploadOptions
): Promise<AxiosResponse> {
//  validateFile("file", file, "parameter");
//  validateOptionalObject("customOptions", customOptions, "parameter", DEFAULT_UPLOAD_OPTIONS);

  const opts = { ...DEFAULT_UPLOAD_OPTIONS, ...this.customOptions, ...customOptions };

  // Validation.
  const url = await buildRequestUrl(this, { endpointPath: opts.endpointLargeUpload });
  const headers = buildRequestHeaders(undefined, opts.customUserAgent, opts.customCookie, opts.s5ApiKey);

  file = ensureFileObjectConsistency(file);
  let filename = file.name;
  if (opts.customFilename) {
    filename = opts.customFilename;
  }

  const onProgress =
    opts.onUploadProgress &&
    function (bytesSent: number, bytesTotal: number) {
      const progress = bytesSent / bytesTotal;

      // @ts-expect-error TS complains.
      opts.onUploadProgress(progress, { loaded: bytesSent, total: bytesTotal });
    };
  const chunkSize = TUS_CHUNK_SIZE;

  const b3hash = await new Promise((resolve, reject) => {
    const hasher = createHash();

//    var fr = new FileReader();
//    fr.onload = (e) => {
    //  hasher.update(fr);
      //var data = fr.result;
      //blake3.hash('"'+fr.result+'"');

//hasher.update(e)

//      resolve(fr.result);
//    };
//    fr.readAsArrayBuffer(file);






            var read = 0;
            var unit = 1024 * 1024;
            var blob;
            var reader = new FileReader();
            reader.readAsArrayBuffer(file.slice(read, read + unit));
            reader.onload = function(e) {
  //              var bytes = Buffer.from(reader.result);
  //              sha1.update(bytes);

 //             hasher.update(bytes)
                read += unit;
                if (read < file.size) {
                    blob = file.slice(read, read + unit);
           
             // hasher.update(ttt)
                    reader.readAsArrayBuffer(blob);
                } else {
             //       var hash = sha1.finalize();
             //       console.log(hash.toString(CryptoJS.enc.Hex)); // print the result
	//	resolve(hasher.digest());

                }
            }












//    stream.on("error", (err) => reject(err));
//    stream.on("data", (chunk) => hasher.update(chunk));
//    stream.on("end", () => resolve(hasher.digest()));
  });
  console.log('b3hash :  '+b3hash);

//  const hash = Buffer.concat([Buffer.alloc(1, mhashBlake3Default), new Uint8Array(b3hash)]);
//  const cid = Buffer.concat([Buffer.alloc(1, cidTypeRaw), hash, numberToBuffer(file.size)]);

  console.log('b3hash :  '+b3hash);
//  console.log('hash :  '+hash);
//  console.log('cid :  '+cid);

  function numberToBuffer(value: number) {
    const view = Buffer.alloc(16);
    let lastIndex = 15;
    for (var index = 0; index <= 15; ++index) {
      if (value % 256 !== 0) {
        lastIndex = index;
      }
      view[index] = value % 256;
      value = value >> 8;
    }
    return view.subarray(0, lastIndex + 1);
  }












  return new Promise((resolve, reject) => {
    const tusOpts = {
      endpoint: url,
      chunkSize,
//      retryDelays: opts.retryDelays,
      metadata: {
//        hash: hash.toString("base64url"),
        filename,
        filetype: file.type,
      },
//      headers,
      onProgress,
      onBeforeRequest: function (req: HttpRequest) {
        const xhr = req.getUnderlyingObject();
        xhr.withCredentials = true;
      },
      onError: (error: Error | DetailedError) => {
        // Return error body rather than entire error.
        const res = (error as DetailedError).originalResponse;
        const newError = res ? new Error(res.getBody().trim()) || error : error;
        reject(newError);
      },
      onSuccess: async () => {
        if (!upload.url) {
          reject(new Error("'upload.url' was not set"));
          return;
        }

        // Call HEAD to get the metadata, including the skylink.
        try {
          const resp = await this.executeRequest({
            ...opts,
            url: upload.url,
            method: "head",
            headers: { ...headers, "tus-resumable": "1.0.0" },
          });
          resolve(resp);
        } catch (err) {
          reject(err);
        }
      },
    };

    const upload = new Upload(file, tusOpts);
    upload.start();
  });
}








/**
 * Uploads a directory to S5-net.
 *
 * @param this - S5Client
 * @param directory - File objects to upload, indexed by their path strings.
 * @param filename - The name of the directory.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @param [customOptions.endpointPath="/s5/upload/directory"] - The relative URL path of the portal endpoint to contact.
 * @returns - The returned skylink.
 * @throws - Will throw if the request is successful but the upload response does not contain a complete response.
 */
export async function uploadDirectory(
  this: S5Client,
  directory: Record<string, File>,
  filename: string,
  customOptions?: CustomUploadOptions
): Promise<UploadRequestResponse> {
  // Validation is done in `uploadDirectoryRequest`.

  const response = await this.uploadDirectoryRequest(directory, filename, customOptions);

  // Sanity check.
//  validateUploadResponse(response);

//  const skylink = formatSkylink(response.data.skylink);
//  return { skylink };

  const responsedS5Cid = response.data.cid;
  return `${responsedS5Cid}`;
}

/**
 * Makes a request to upload a directory to S5-net.
 *
 * @param this - S5Client
 * @param directory - File objects to upload, indexed by their path strings.
 * @param filename - The name of the directory.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @param [customOptions.endpointPath="/s5/upload/directory"] - The relative URL path of the portal endpoint to contact.
 * @returns - The upload response.
 * @throws - Will throw if the input filename is not a string.
 */
export async function uploadDirectoryRequest(
  this: S5Client,
  directory: Record<string, File>,
  filename: string,
  customOptions?: CustomUploadOptions
): Promise<AxiosResponse> {
//  validateObject("directory", directory, "parameter");
//  validateString("filename", filename, "parameter");
//  validateOptionalObject("customOptions", customOptions, "parameter", DEFAULT_UPLOAD_OPTIONS);

  const opts = { ...DEFAULT_UPLOAD_OPTIONS, ...this.customOptions, ...customOptions };

  const formData = new FormData();
  Object.entries(directory).forEach(([path, file]) => {
    file = ensureFileObjectConsistency(file as File);
    formData.append(PORTAL_DIRECTORY_FILE_FIELD_NAME, file as File, path);
  });

  const query: { [key: string]: string | undefined } = { filename };
  if (opts.tryFiles) {
    query.tryfiles = JSON.stringify(opts.tryFiles);
  }
  if (opts.errorPages) {
    query.errorpages = JSON.stringify(opts.errorPages);
  }

  const response = await this.executeRequest({
    ...opts,
    endpointPath: opts.endpointDirectoryUpload,
    method: "post",
    data: formData,
    query,
  });

  return response;
}

/**
 * Splits the size into the number of parts, aligning all but the last part on
 * chunk boundaries. Called if parallel uploads are used.
 *
 * Constraints:
 *
 * - Each part must be chunk-aligned, except for the last part. So we put any
 *   non-aligned leftover in the last part.
 * - The parts should be as close in size to each other as possible.
 *
 * @param totalSize - The total size of the upload.
 * @param partCount - The number of parts (equal to the value of `parallelUploads` used).
 * @param chunkSize - The size of the chunk to use.
 * @returns - An array of parts with start and end boundaries.
 */
export function splitSizeIntoChunkAlignedParts(
  totalSize: number,
  partCount: number,
  chunkSize: number
): Array<{ start: number; end: number }> {
  if (partCount < 1) {
    throwValidationError("partCount", partCount, "parameter", "greater than or equal to 1");
  }
  if (chunkSize < 1) {
    throwValidationError("chunkSize", chunkSize, "parameter", "greater than or equal to 1");
  }
  // NOTE: Unexpected code flow. `uploadLargeFileRequest` should not enable
  // parallel uploads for this case.
  if (totalSize <= chunkSize) {
    throwValidationError("totalSize", totalSize, "parameter", `greater than the size of a chunk ('${chunkSize}')`);
  }

  const partSizes = new Array(partCount).fill(0);

  // Assign chunks to parts in order, looping back to the beginning if we get to
  // the end of the parts array.
  const numFullChunks = Math.floor(totalSize / chunkSize);
  for (let i = 0; i < numFullChunks; i++) {
    partSizes[i % partCount] += chunkSize;
  }

  // The leftover size that must go into the last part.
  const leftover = totalSize % chunkSize;
  // If there is non-chunk-aligned leftover, add it.
  if (leftover > 0) {
    // Assign the leftover to the part after the last part that was visited, or
    // the last part in the array if all parts were used.
    //
    // NOTE: We don't need to worry about empty parts, tus ignores those.
    const lastIndex = Math.min(numFullChunks, partCount - 1);
    partSizes[lastIndex] += leftover;
  }

  // Convert sizes into parts.
  const parts = [];
  let lastBoundary = 0;
  for (let i = 0; i < partCount; i++) {
    parts.push({
      start: lastBoundary,
      end: lastBoundary + partSizes[i],
    });
    lastBoundary = parts[i].end;
  }

  return parts;
}

/**
 * Sometimes file object might have had the type property defined manually with
 * Object.defineProperty and some browsers (namely firefox) can have problems
 * reading it after the file has been appended to form data. To overcome this,
 * we recreate the file object using native File constructor with a type defined
 * as a constructor argument.
 *
 * @param file - The input file.
 * @returns - The processed file.
 */
function ensureFileObjectConsistency(file: File): File {
  return new File([file], file.name, { type: getFileMimeType(file) });
}
