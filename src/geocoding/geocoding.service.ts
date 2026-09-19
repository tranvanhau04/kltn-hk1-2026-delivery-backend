import { Injectable, Logger } from '@nestjs/common';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'IUH-SmartExpress-KLTN/1.0 (contact@iuh.edu.vn)';
const REQUEST_TIMEOUT_MS = 5000;

export interface GeocodedResult {
  latitude: number;
  longitude: number;
  /** true if geocoded from Nominatim; false if fallback depot coords were used */
  isGeocoded: boolean;
  displayName?: string;
}

export interface ReverseGeocodedResult {
  displayName: string;
}

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  /**
   * Forward geocode an address using Nominatim.
   * Falls back to depot coordinates when geocoding fails.
   * Respects Nominatim usage policy: descriptive User-Agent header included.
   */
  async geocodeAddress(
    address: string,
    fallbackLat: number,
    fallbackLng: number,
  ): Promise<GeocodedResult> {
    const url = `${NOMINATIM_BASE}/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=vn`;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await this.fetchWithTimeout(url, USER_AGENT);

        if (res.status === 429) {
          this.logger.warn(`Nominatim rate-limited (attempt ${attempt}), backing off 1s`);
          await this.delay(1000);
          continue;
        }

        if (!res.ok) {
          this.logger.warn(`Nominatim HTTP ${res.status} on attempt ${attempt}`);
          if (attempt === 1) {
            await this.delay(500);
            continue;
          }
          break;
        }

        const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;

        if (data && data.length > 0) {
          return {
            latitude: parseFloat(data[0].lat),
            longitude: parseFloat(data[0].lon),
            isGeocoded: true,
            displayName: data[0].display_name,
          };
        }

        this.logger.warn(`Nominatim returned no results for: "${address}"`);
        break;
      } catch (err) {
        this.logger.warn(`Nominatim fetch error on attempt ${attempt}: ${String(err)}`);
        if (attempt === 1) await this.delay(500);
      }
    }

    // Fallback to depot / hub coordinates
    this.logger.warn(
      `Geocoding failed for "${address}". Falling back to depot coords (${fallbackLat}, ${fallbackLng}).`,
    );
    return {
      latitude: fallbackLat,
      longitude: fallbackLng,
      isGeocoded: false,
    };
  }

  /**
   * Reverse geocode coordinates to a human-readable address using Nominatim.
   */
  async reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodedResult | null> {
    const url = `${NOMINATIM_BASE}/reverse?format=json&lat=${lat}&lon=${lng}`;
    try {
      const res = await this.fetchWithTimeout(url, USER_AGENT);
      if (!res.ok) return null;
      const data = (await res.json()) as { display_name?: string };
      return data.display_name ? { displayName: data.display_name } : null;
    } catch {
      return null;
    }
  }

  private async fetchWithTimeout(url: string, userAgent: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': userAgent,
          Accept: 'application/json',
        },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
