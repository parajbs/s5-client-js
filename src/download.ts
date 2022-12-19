import { ResponseType } from "axios";

import { S5Client } from "./client";
import { convertSkylinkToBase32, formatSkylink } from "./skylink/format";
import { parseSkylink } from "./skylink/parse";
import { BaseCustomOptions, DEFAULT_BASE_OPTIONS } from "./utils/options";
import { addUrlSubdomain, addUrlQuery, makeUrl } from "./utils/url";
import {
//  validateOptionalObject,
  validateString,
} from "./utils/validation";


/**
 * Custom download options.
 *
 * @property [endpointDownload] - The relative URL path of the portal endpoint to contact.
 * @property [download=false] - Indicates to `getSkylinkUrl` whether the file should be downloaded (true) or opened in the browser (false). `downloadFile` and `openFile` override this value.
 * @property [path] - A path to append to the skylink, e.g. `dir1/dir2/file`. A Unix-style path is expected. Each path component will be URL-encoded.
 * @property [range] - The Range request header to set for the download. Not applicable for in-borwser downloads.
 * @property [responseType] - The response type.
 * @property [subdomain=false] - Whether to return the final skylink in subdomain format.
 */
export type CustomDownloadOptions = BaseCustomOptions & {
  endpointDownload?: string;
  download?: boolean;
  path?: string;
  range?: string;
  responseType?: ResponseType;
  subdomain?: boolean;
};

export type CustomGetMetadataOptions = BaseCustomOptions & {
  endpointGetMetadata?: string;
};

/**
 * The response for a get metadata request.
 *
 * @property metadata - The metadata in JSON format.
 * @property portalUrl - The URL of the portal.
 * @property skylink - 46-character skylink.
 */
export type GetMetadataResponse = {
  metadata: Record<string, unknown>;
  portalUrl: string;
  skylink: string;
};

export const DEFAULT_DOWNLOAD_OPTIONS = {
  ...DEFAULT_BASE_OPTIONS,
  endpointDownload: "/",
  download: false,
  path: undefined,
  range: undefined,
  responseType: undefined,
  subdomain: false,
};

const DEFAULT_GET_METADATA_OPTIONS = {
  ...DEFAULT_BASE_OPTIONS,
  endpointGetMetadata: "/s5/metadata",
};

/**
 * Initiates a download of the content of the skylink within the browser.
 *
 * @param this - S5Client
 * @param skylinkUrl - 46-character skylink, or a valid skylink URL. Can be followed by a path. Note that the skylink will not be encoded, so if your path might contain special characters, consider using `customOptions.path`.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @param [customOptions.endpointDownload="/"] - The relative URL path of the portal endpoint to contact.
 * @returns - The full URL that was used.
 * @throws - Will throw if the skylinkUrl does not contain a skylink or if the path option is not a string.
 */
export async function downloadFile(
  this: S5Client,
  skylinkUrl: string,
  customOptions?: CustomDownloadOptions
): Promise<string> {
  // Validation is done in `getSkylinkUrl`.

  const opts = { ...DEFAULT_DOWNLOAD_OPTIONS, ...this.customOptions, ...customOptions, download: true };

  const url = await this.getSkylinkUrl(skylinkUrl, opts);

  // Download the url.
  window.location.assign(url);

  return url;
}

/**
 * Constructs the full URL for the given skylink.
 *
 * @param this - S5Client
 * @param skylinkUrl - Base64 skylink, or a valid URL that contains a skylink. See `downloadFile`.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @param [customOptions.endpointDownload="/"] - The relative URL path of the portal endpoint to contact.
 * @returns - The full URL for the skylink.
 * @throws - Will throw if the skylinkUrl does not contain a skylink or if the path option is not a string.
 */
export async function getSkylinkUrl(
  this: S5Client,
  skylinkUrl: string,
  customOptions?: CustomDownloadOptions
): Promise<string> {
  // Validation is done in `getSkylinkUrlForPortal`.

  const opts = { ...DEFAULT_DOWNLOAD_OPTIONS, ...this.customOptions, ...customOptions };

  const portalUrl = await this.portalUrl();

  return getSkylinkUrlForPortal(portalUrl, skylinkUrl, opts);
}

/**
 * Gets the skylink URL without an initialized client.
 *
 * @param portalUrl - The portal URL.
 * @param skylinkUrl - Base64 skylink, or a valid URL that contains a skylink. See `downloadFile`.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @param [customOptions.endpointDownload="/"] - The relative URL path of the portal endpoint.
 * @returns - The full URL for the skylink.
 * @throws - Will throw if the skylinkUrl does not contain a skylink or if the path option is not a string.
 */
export function getSkylinkUrlForPortal(
  portalUrl: string,
  skylinkUrl: string,
  customOptions?: CustomDownloadOptions
): string {
  validateString("portalUrl", portalUrl, "parameter");
  validateString("skylinkUrl", skylinkUrl, "parameter");
//  validateOptionalObject("customOptions", customOptions, "parameter", DEFAULT_DOWNLOAD_OPTIONS);

  const opts = { ...DEFAULT_DOWNLOAD_OPTIONS, ...customOptions };

  const query = buildQuery(opts.download);

  // URL-encode the path.
  let path = "";
  if (opts.path) {
    if (typeof opts.path !== "string") {
      throw new Error(`opts.path has to be a string, ${typeof opts.path} provided`);
    }

    // Encode each element of the path separately and join them.
    //
    // Don't use encodeURI because it does not encode characters such as '?'
    // etc. These are allowed as filenames on S5 and should be encoded so
    // they are not treated as URL separators.
    path = opts.path
      .split("/")
      .map((element: string) => encodeURIComponent(element))
      .join("/");
  }

  let url;
  if (opts.subdomain) {
    // The caller wants to use a URL with the skylink as a base32 subdomain.
    //
    // Get the path from the skylink. Use the empty string if not found.
    const skylinkPath = parseSkylink(skylinkUrl, { onlyPath: true }) ?? "";
    // Get just the skylink.
    let skylink = parseSkylink(skylinkUrl);
    if (skylink === null) {
      throw new Error(`Could not get skylink out of input '${skylinkUrl}'`);
    }
    // Convert the skylink (without the path) to base32.
    skylink = convertSkylinkToBase32(skylink);
    url = addUrlSubdomain(portalUrl, skylink);
    url = makeUrl(url, skylinkPath, path);
  } else {
    // Get the skylink including the path.
    const skylink = parseSkylink(skylinkUrl, { includePath: true });
    if (skylink === null) {
      throw new Error(`Could not get skylink with path out of input '${skylinkUrl}'`);
    }
    // Add additional path if passed in.
    url = makeUrl(portalUrl, opts.endpointDownload, skylink);
    url = makeUrl(url, path);
  }

  return addUrlQuery(url, query);
}

/**
 * Gets only the metadata for the given skylink without the contents.
 *
 * @param this - S5Client
 * @param skylinkUrl - Base64 skylink, or a valid URL that contains a skylink. See `downloadFile`.
 * @param [customOptions] - Additional settings that can optionally be set. See `downloadFile` for the full list.
 * @param [customOptions.endpointGetMetadata="/"] - The relative URL path of the portal endpoint to contact.
 * @returns - The metadata in JSON format. Empty if no metadata was found.
 * @throws - Will throw if the skylinkUrl does not contain a skylink or if the path option is not a string.
 */
export async function getMetadata(
  this: S5Client,
  skylinkUrl: string,
  customOptions?: CustomGetMetadataOptions
): Promise<GetMetadataResponse> {
//  validateOptionalObject("customOptions", customOptions, "parameter", DEFAULT_GET_METADATA_OPTIONS);
  // Rest of validation is done in `getSkylinkUrl`.

  const opts = { ...DEFAULT_GET_METADATA_OPTIONS, ...this.customOptions, ...customOptions };

  // Don't include the path for now since the endpoint doesn't support it.
  const path = parseSkylink(skylinkUrl, { onlyPath: true });
  if (path) {
    throw new Error("Skylink string should not contain a path");
  }
  const getSkylinkUrlOpts = { endpointDownload: opts.endpointGetMetadata };
  const url = await this.getSkylinkUrl(skylinkUrl, getSkylinkUrlOpts);

  const response = await this.executeRequest({
    ...opts,
    method: "GET",
    url,
  });

  // TODO: Pass subdomain option.
//  const inputSkylink = parseSkylink(skylinkUrl);
//  validateGetMetadataResponse(response, inputSkylink as string);

  const metadata = response.data;

  const portalUrl = response.headers["s5-portal-api"];
  const skylink = formatSkylink(response.headers["s5-skylink"]);

  return { metadata, portalUrl, skylink };
}

// =======
// Helpers
// =======

/**
 * Helper function that builds the URL query.
 *
 * @param download - Whether to set attachment=true.
 * @returns - The URL query.
 */
function buildQuery(download: boolean): { [key: string]: string | undefined } {
  const query: { [key: string]: string | undefined } = {};
  if (download) {
    // Set the "attachment" parameter.
    query.attachment = "true";
  }
  return query;
}







