-- Runs once when the local Postgres volume is first initialised.
-- Creates an isolated database used by the API integration test-suite.
CREATE DATABASE estate_test;
