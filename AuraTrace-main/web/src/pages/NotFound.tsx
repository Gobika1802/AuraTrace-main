import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/feedback";

export function NotFoundPage() {
  return (
    <Card className="mx-auto mt-16 max-w-lg">
      <EmptyState
        icon={<Compass className="h-6 w-6" />}
        title="Page not found"
        description="The page you are looking for does not exist or has been moved."
        action={
          <Link to="/">
            <Button>Back to overview</Button>
          </Link>
        }
      />
    </Card>
  );
}
