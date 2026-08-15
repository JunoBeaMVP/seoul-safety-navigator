import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { getNearbyShelters, getSafetySnapshot, getWalkingRoute, type RiskType } from "./safety";

const locationInput = z.object({
  latitude: z.number().min(37.42).max(37.72),
  longitude: z.number().min(126.75).max(127.2),
});

const riskTypeInput = z.enum(["heatwave", "rain", "civil"]);

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  safety: router({
    snapshot: publicProcedure.input(locationInput).query(({ input }) =>
      getSafetySnapshot(input.latitude, input.longitude)
    ),
    shelters: publicProcedure
      .input(locationInput.extend({ riskType: riskTypeInput }))
      .query(({ input }) => getNearbyShelters(input.latitude, input.longitude, input.riskType as RiskType)),
    route: publicProcedure
      .input(z.object({ origin: locationInput, destination: locationInput }))
      .query(({ input }) => getWalkingRoute(input.origin, input.destination)),
  }),
});

export type AppRouter = typeof appRouter;
