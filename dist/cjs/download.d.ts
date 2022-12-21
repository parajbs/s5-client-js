import { ResponseType } from "axios";
import { S5Client } from "./client";
import { BaseCustomOptions } from "./utils/options";
/**
 * Custom download options.
 *
 * @property [endpointDownload] - The relative URL path of the portal endpoint to contact.
 * @property [download=false] - Indicates to `getCidUrl` whether the file should be downloaded (true) or opened in the browser (false). `downloadFile` and `openFile` override this value.
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
};
export declare const DEFAULT_DOWNLOAD_OPTIONS: {
    endpointDownload: string;
    download: boolean;
    path: undefined;
    range: undefined;
    responseType: undefined;
    subdomain: boolean;
    APIKey: string;
    s5ApiKey: string;
    customUserAgent: string;
    customCookie: string;
    onDownloadProgress: undefined;
    onUploadProgress: undefined;
    loginFn: undefined;
};
/**
 * Initiates a download of the content of the skylink within the browser.
 *
 * @param this - S5Client
 * @param cid - 46-character skylink, or a valid skylink URL. Can be followed by a path. Note that the skylink will not be encoded, so if your path might contain special characters, consider using `customOptions.path`.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @param [customOptions.endpointDownload="/"] - The relative URL path of the portal endpoint to contact.
 * @returns - The full URL that was used.
 * @throws - Will throw if the cid does not contain a skylink or if the path option is not a string.
 */
export declare function downloadFile(this: S5Client, cid: string, customOptions?: CustomDownloadOptions): Promise<string>;
/**
 * Constructs the full URL for the given skylink.
 *
 * @param this - S5Client
 * @param cid - Base64 skylink, or a valid URL that contains a skylink. See `downloadFile`.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @param [customOptions.endpointDownload="/"] - The relative URL path of the portal endpoint to contact.
 * @returns - The full URL for the skylink.
 * @throws - Will throw if the cid does not contain a skylink or if the path option is not a string.
 */
export declare function getCidUrl(this: S5Client, cid: string, customOptions?: CustomDownloadOptions): Promise<string>;
/**
 * Gets the skylink URL without an initialized client.
 *
 * @param portalUrl - The portal URL.
 * @param cid - Base64 skylink, or a valid URL that contains a skylink. See `downloadFile`.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @param [customOptions.endpointDownload="/"] - The relative URL path of the portal endpoint.
 * @returns - The full URL for the skylink.
 * @throws - Will throw if the cid does not contain a skylink or if the path option is not a string.
 */
export declare function getCidUrlForPortal(portalUrl: string, cid: string, customOptions?: CustomDownloadOptions): string;
/**
 * Gets only the metadata for the given skylink without the contents.
 *
 * @param this - S5Client
 * @param cid - Base64 cid.
 * @param [customOptions] - Additional settings that can optionally be set. See `downloadFile` for the full list.
 * @param [customOptions.endpointGetMetadata="/"] - The relative URL path of the portal endpoint to contact.
 * @returns - The metadata in JSON format. Empty if no metadata was found.
 * @throws - Will throw if the cid does not contain a cid .
 */
export declare function getMetadata(this: S5Client, cid: string, customOptions?: CustomGetMetadataOptions): Promise<GetMetadataResponse>;
//# sourceMappingURL=download.d.ts.map