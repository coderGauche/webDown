export type PageMetadata = {
  title: string;
  tabUrl: string;
  baseUrl: string;
  finalUrl: string;
};

export type PageMetadataSource = Pick<Document, 'title' | 'baseURI' | 'URL'>;

export function readPageMetadata(source: PageMetadataSource, tabUrl = source.URL): PageMetadata {
  return {
    title: source.title,
    tabUrl,
    baseUrl: source.baseURI,
    finalUrl: source.URL,
  };
}
