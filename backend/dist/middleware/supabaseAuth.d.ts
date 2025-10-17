import type { Request, Response, NextFunction } from "express";
export type AuthUser = {
    sub: string;
    email?: string;
    role?: string;
};
declare global {
    namespace Express {
        interface Request {
            user?: AuthUser;
        }
    }
}
export declare function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
//# sourceMappingURL=supabaseAuth.d.ts.map