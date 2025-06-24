type Fetch = (request: Request) => Promise<Response>;

export async function testStatus(fetch: Fetch): Promise<boolean> {
  try {
    const request = new Request('http://example.com/status', {
      method: 'GET',
    });

    const response = await fetch(request);

    if (!response.ok) {
      console.error(`Status endpoint returned ${response.status}`);
      return false;
    }

    const data = await response.json();

    if (data.ready !== true) {
      console.error(`Expected { ready: true }, got ${JSON.stringify(data)}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Failed to test status endpoint:`, error);
    return false;
  }
}
