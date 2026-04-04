import { NextRequest, NextResponse } from "next/server";
import { USERS, authenticateUser } from "@/lib/aws";

export async function POST(request: NextRequest) {
  try {
    const { username } = await request.json();

    if (!username || !USERS[username]) {
      return NextResponse.json({ detail: "Unknown user" }, { status: 400 });
    }

    const token = await authenticateUser(username);

    return NextResponse.json({
      token,
      user: { username, ...USERS[username] },
    });
  } catch (err) {
    const error = err as Error & { name?: string };
    const name = error.name || "";

    console.error("[login] error:", name, error.message);

    // Cognito authentication failures → 401
    if (
      name === "NotAuthorizedException" ||
      name === "UserNotFoundException" ||
      name === "UserNotConfirmedException"
    ) {
      return NextResponse.json(
        { detail: `Authentication failed: ${error.message}` },
        { status: 401 }
      );
    }

    // AWS credentials not configured → 500
    if (name === "CredentialsProviderError") {
      return NextResponse.json(
        {
          detail:
            "AWS credentials not configured. Set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or configure ~/.aws/credentials.",
        },
        { status: 500 }
      );
    }

    // SSM parameter missing (infra not deployed or wrong region) → 500
    if (
      name === "ParameterNotFound" ||
      error.message?.includes("Auth config not available")
    ) {
      return NextResponse.json(
        {
          detail:
            "Auth config not found in SSM. Ensure the infrastructure is deployed (cdk deploy) and AWS_REGION matches the deployment region.",
        },
        { status: 500 }
      );
    }

    // Any other server-side error → 500
    return NextResponse.json(
      { detail: `Server error during login: ${error.message}` },
      { status: 500 }
    );
  }
}
