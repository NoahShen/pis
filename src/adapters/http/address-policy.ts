import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import ipaddr from "ipaddr.js";

import { AcquisitionError } from "../transport.js";

export interface DnsAddress {
  readonly address: string;
  readonly family: number;
}

export type DnsResolver = (hostname: string) => Promise<readonly DnsAddress[]>;

export type PinnedDnsLookup = (
  hostname: string,
  options: {
    readonly all?: boolean;
    readonly family?: number | "IPv4" | "IPv6";
    readonly hints?: number;
  },
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | DnsAddress[],
    family?: number,
  ) => void,
) => void;

export const MAX_RESOLVED_ADDRESSES = 32;

const IPV4_SPECIAL_RANGES = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
] as const;

const IPV6_SPECIAL_RANGES = [
  "2001::/23",
  "2001:db8::/32",
  "2002::/16",
  "3fff::/20",
] as const;

const IPV4_RANGES = IPV4_SPECIAL_RANGES.map((range) => ipaddr.parseCIDR(range));
const IPV6_RANGES = IPV6_SPECIAL_RANGES.map((range) => ipaddr.parseCIDR(range));

const RELAXABLE_IPV4_RANGES = new Set([
  "carrierGradeNat",
  "linkLocal",
  "loopback",
  "private",
  "reserved",
  "unspecified",
]);

const RELAXABLE_IPV6_RANGES = new Set([
  "linkLocal",
  "loopback",
  "reserved",
  "uniqueLocal",
  "unspecified",
]);

export const systemDnsResolver: DnsResolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

function blocked(): AcquisitionError {
  return new AcquisitionError("blocked_url", false, null);
}

function dnsFailed(): AcquisitionError {
  return new AcquisitionError("dns_failed", false, null);
}

function rawAuthority(rawUrl: string): string | null {
  const match = /^[a-z][a-z\d+.-]*:\/\/([^/?#\\]*)/i.exec(rawUrl);
  return match?.[1] ?? null;
}

function normalizedHostname(url: URL): string {
  const hostname = url.hostname;
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function isLocalhostName(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "localhost" || normalized.endsWith(".localhost");
}

export function canonicalizeRestrictedUrl(rawUrl: string): URL {
  if (
    typeof rawUrl !== "string" ||
    rawUrl.length === 0 ||
    /[\u0000-\u001f\u007f\\]/.test(rawUrl)
  ) {
    throw blocked();
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw blocked();
  }

  const parsedAuthority = rawAuthority(rawUrl);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    parsedAuthority === null ||
    parsedAuthority.length === 0 ||
    url.hostname.length === 0 ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    parsedAuthority.includes("@") ||
    url.port.length > 0 ||
    rawUrl.includes("#") ||
    url.hash.length > 0 ||
    isLocalhostName(normalizedHostname(url))
  ) {
    throw blocked();
  }

  return url;
}

function validateIpv4(
  address: ipaddr.IPv4,
  allowPrivateAddresses: boolean,
): ipaddr.IPv4 {
  if (allowPrivateAddresses) {
    const range = address.range();
    if (range !== "unicast" && !RELAXABLE_IPV4_RANGES.has(range)) {
      throw blocked();
    }
    return address;
  }
  if (
    address.range() !== "unicast" ||
    IPV4_RANGES.some((range) => address.match(range))
  ) {
    throw blocked();
  }
  return address;
}

export function validateResolvedAddress(
  address: string,
  family?: number,
  allowPrivateAddresses = false,
): DnsAddress {
  const candidate = address.trim();
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(candidate);
  } catch {
    throw blocked();
  }

  let normalizedFamily: 4 | 6;
  let normalizedAddress: string;
  if (parsed.kind() === "ipv4") {
    const ipv4 = validateIpv4(parsed as ipaddr.IPv4, allowPrivateAddresses);
    normalizedFamily = 4;
    normalizedAddress = ipv4.toString();
  } else if ((parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    const ipv6 = parsed as ipaddr.IPv6;
    const ipv4 = validateIpv4(ipv6.toIPv4Address(), allowPrivateAddresses);
    normalizedFamily = 4;
    normalizedAddress = ipv4.toString();
  } else {
    const ipv6 = parsed as ipaddr.IPv6;
    const relaxedRange = RELAXABLE_IPV6_RANGES.has(ipv6.range());
    const outsideAllowedUnicast =
      ipv6.range() !== "unicast" ||
      !ipv6.match(ipaddr.parseCIDR("2000::/3")) ||
      IPV6_RANGES.some((range) => ipv6.match(range));
    if (outsideAllowedUnicast && !(allowPrivateAddresses && relaxedRange)) {
      throw blocked();
    }
    normalizedFamily = 6;
    normalizedAddress = ipv6.toRFC5952String();
  }

  const mappedIpv6 =
    parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress();
  if (
    family !== undefined &&
    family !== 0 &&
    family !== normalizedFamily &&
    !(mappedIpv6 && family === 6)
  ) {
    throw blocked();
  }

  return { address: normalizedAddress, family: normalizedFamily };
}

export async function resolveRestrictedAddress(
  url: URL,
  resolver: DnsResolver = systemDnsResolver,
  allowPrivateAddresses = false,
): Promise<DnsAddress> {
  const hostname = normalizedHostname(url);
  const literalFamily = isIP(hostname);
  if (literalFamily !== 0) {
    return validateResolvedAddress(
      hostname,
      literalFamily,
      allowPrivateAddresses,
    );
  }

  let addresses: readonly DnsAddress[];
  try {
    addresses = await resolver(hostname);
  } catch {
    throw dnsFailed();
  }

  if (addresses.length === 0) {
    throw dnsFailed();
  }
  if (addresses.length > MAX_RESOLVED_ADDRESSES) {
    throw blocked();
  }

  const validated = addresses.map((entry) =>
    validateResolvedAddress(entry.address, entry.family, allowPrivateAddresses),
  );
  const first = validated[0];
  if (first === undefined) {
    throw dnsFailed();
  }
  return first;
}

export function createPinnedLookup(address: DnsAddress): PinnedDnsLookup {
  return (_hostname, options, callback) => {
    const requestedFamily =
      options.family === "IPv4"
        ? 4
        : options.family === "IPv6"
          ? 6
          : options.family;
    if (
      requestedFamily !== undefined &&
      requestedFamily !== 0 &&
      requestedFamily !== address.family
    ) {
      const error = new Error(
        "Address family mismatch",
      ) as NodeJS.ErrnoException;
      error.code = "EAI_ADDRFAMILY";
      callback(error, "");
      return;
    }

    if (options.all === true) {
      callback(null, [{ address: address.address, family: address.family }]);
      return;
    }
    callback(null, address.address, address.family);
  };
}
