import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiGet, useApiPost } from '../hooks/useApi.js';

interface ScheduleTimezoneProps {
  timezone?: string;
}

interface TimezoneResponse {
  timezone: string;
}

const formatTimezoneDisplay = (tz: string): string => {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    });
    const parts = formatter.formatToParts(new Date());
    const offsetPart = parts.find((p) => p.type === 'timeZoneName');
    const offset = offsetPart ? offsetPart.value : '';
    return `${tz} (${offset})`;
  } catch {
    return tz;
  }
};

const TimezoneGet = () => {
  const { data, loading, error } = useApiGet<TimezoneResponse>(
    '/brains/schedules/timezone'
  );

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return (
      <Box>
        <Text>Loading timezone...</Text>
      </Box>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>Project timezone:</Text>{' '}
        {formatTimezoneDisplay(data.timezone)}
      </Text>
    </Box>
  );
};

const TimezoneSet = ({ timezone }: { timezone: string }) => {
  const [done, setDone] = useState(false);
  const [result, setResult] = useState<TimezoneResponse | null>(null);

  const { execute, loading, error } = useApiPost<TimezoneResponse>(
    '/brains/schedules/timezone',
    {
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    }
  );

  useEffect(() => {
    const setTz = async () => {
      try {
        const body = JSON.stringify({ timezone });
        const res = await execute(body);
        setResult(res);
        setDone(true);
      } catch {
        // Error handled by useApiPost
      }
    };

    setTz();
  }, []);

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return (
      <Box>
        <Text>Setting timezone...</Text>
      </Box>
    );
  }

  if (done && result) {
    return (
      <Box flexDirection="column">
        <Text color="green">
          Timezone set to {formatTimezoneDisplay(result.timezone)}
        </Text>
      </Box>
    );
  }

  return null;
};

export const ScheduleTimezone = ({ timezone }: ScheduleTimezoneProps) => {
  if (timezone) {
    // Validate timezone locally before sending to server
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      return (
        <ErrorComponent
          error={{
            title: 'Invalid Timezone',
            message: `"${timezone}" is not a valid IANA timezone.`,
            details:
              'Use a valid IANA timezone like "America/Chicago", "Europe/London", or "Asia/Tokyo".',
          }}
        />
      );
    }
    return <TimezoneSet timezone={timezone} />;
  }

  return <TimezoneGet />;
};
